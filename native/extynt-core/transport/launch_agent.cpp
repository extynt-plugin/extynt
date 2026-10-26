// Builds the sidecar start commands and runs one start on its own thread with a timeout.
#include "launch_agent.h"

#include <chrono>
#include <cstddef>
#include <mutex>
#include <string>
#include <string_view>
#include <thread>
#include <utility>
#include <vector>

#include "child_process.h"

#ifndef _WIN32
#include <sys/types.h>
#endif

namespace extynt {

namespace {

constexpr int kPollMs = 20;

bool needsQuotes(const std::string& argument) {
  return argument.empty() || argument.find_first_of(" \t\n\v\"") != std::string::npos;
}

void appendQuoted(std::string& line, const std::string& argument) {
  line += '"';
  std::size_t backslashes = 0;
  for (const char c : argument) {
    if (c == '\\') {
      ++backslashes;
      continue;
    }
    if (c == '"') line.append((backslashes * 2) + 1, '\\');
    else line.append(backslashes, '\\');
    backslashes = 0;
    line += c;
  }
  line.append(backslashes * 2, '\\');
  line += '"';
}

}

#ifndef _WIN32
std::vector<std::string> kickstartArguments(uid_t uid, const std::string& label) {
  return {"launchctl", "kickstart", "gui/" + std::to_string(uid) + "/" + label};
}
#endif

std::vector<std::string> schtasksArguments(const std::string& task) { return {"schtasks.exe", "/Run", "/TN", task}; }

namespace {
bool isAsciiLetter(wchar_t unit) { return (unit >= L'A' && unit <= L'Z') || (unit >= L'a' && unit <= L'z'); }

bool isAsciiDigit(wchar_t unit) { return unit >= L'0' && unit <= L'9'; }

bool isPlainTaskUnit(wchar_t unit) {
  constexpr std::wstring_view kPunctuation = L"._-";
  return isAsciiLetter(unit) || isAsciiDigit(unit) || kPunctuation.find(unit) != std::wstring_view::npos;
}
}

std::string sidecarTaskName(const std::wstring& account) {
  std::string name = "extynt sidecar ";
  for (const wchar_t unit : account) name += isPlainTaskUnit(unit) ? static_cast<char>(unit) : '_';
  return name;
}

std::string windowsCommandLine(const std::vector<std::string>& arguments) {
  std::string line;
  for (const std::string& argument : arguments) {
    if (!line.empty()) line += ' ';
    if (needsQuotes(argument)) appendQuoted(line, argument);
    else line += argument;
  }
  return line;
}

Kickstart::~Kickstart() { join(); }

bool Kickstart::waitOrCancel(int pollMs) {
  std::unique_lock<std::mutex> lock(mutex_);
  wake_.wait_for(lock, std::chrono::milliseconds(pollMs), [this] { return cancelled_; });
  return cancelled_;
}

void Kickstart::supervise(ChildProcess& child, KickstartResult& result) {
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeoutMs_);
  for (;;) {
    const ChildState state = child.poll(result.exitCode);
    if (state == ChildState::Exited || state == ChildState::Lost) return;
    if (waitOrCancel(kPollMs) || std::chrono::steady_clock::now() >= deadline) {
      child.killAndReap();
      result.timedOut = true;
      return;
    }
  }
}

void Kickstart::run(const std::string& program, const std::vector<std::string>& arguments, const Done& done) {
  KickstartResult result;
  ChildProcess child;
  result.spawned = child.spawn(program, arguments, result.error);
  if (result.spawned) supervise(child, result);
  if (done) done(result);
}

void Kickstart::entry(const std::string& program, const std::vector<std::string>& arguments,
                      const Done& done) noexcept {
  KickstartResult failure;
  try {
    run(program, arguments, done);
    return;
  } catch (...) {
    failure.error = "kickstart threw";
  }
  try {
    if (done) done(failure);
  } catch (...) {
    return;
  }
}

void Kickstart::start(const std::string& program, const std::vector<std::string>& arguments, Done done) {
  const std::scoped_lock lock(mutex_);
  if (started_) return;
  started_ = true;
  thread_ = std::thread(&Kickstart::entry, this, program, arguments, std::move(done));
}

void Kickstart::join() {
  {
    const std::scoped_lock lock(mutex_);
    cancelled_ = true;
  }
  wake_.notify_all();
  if (thread_.joinable()) thread_.join();
}

}

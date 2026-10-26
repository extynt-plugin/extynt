// The plugin log: timestamped lines in the state directory, and a guard for exceptions dropped at a callback boundary.
#include "ae_log.h"

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <ios>
#include <mutex>
#include <string>

#include "discovery.h"
#include "log_format.h"

namespace extynt::ae {

namespace {

struct LogState {
  std::mutex mutex;
  std::string path;
};

LogState& logState() {
  static LogState state;
  return state;
}

int64_t unixMillisNow() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch())
      .count();
}

}

std::string stateDirectory() {
  const std::string discovery = defaultDiscoveryPath();
  const size_t slash = discovery.find_last_of('/');
  return slash == std::string::npos ? "" : discovery.substr(0, slash);
}

void startLogFile(const std::string& path) {
  LogState& state = logState();
  const std::scoped_lock lock(state.mutex);
  state.path = path;
  std::string error;
  ensureParentDirectories(path, error);
  static_cast<void>(std::rename(path.c_str(), rotatedLogPath(path).c_str()));
  const std::ofstream created(path, std::ios::out | std::ios::trunc);
}

void logLine(const std::string& text) {
  LogState& state = logState();
  const std::scoped_lock lock(state.mutex);
  if (state.path.empty()) return;
  std::ofstream file(state.path, std::ios::out | std::ios::app);
  if (file) file << formatLogTime(unixMillisNow()) << ' ' << text << '\n';
}

void logDroppedException(const char* where) noexcept {
  try {
    logLine(std::string("exception dropped at the host boundary: ") + where);
  } catch (...) {
    return;
  }
}

}

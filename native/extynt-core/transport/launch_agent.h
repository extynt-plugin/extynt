// Starting the sidecar from the plugin at load (docs/native/protocol.md, 5): `launchctl kickstart` on macOS and
// `schtasks /Run` on Windows run on their own thread, so nothing on After Effects' main thread waits for them. No SDK.
#pragma once

#ifndef _WIN32
#include <sys/types.h>
#endif

#include <condition_variable>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "child_process.h"

namespace extynt {

constexpr const char* kSidecarLaunchLabel = "com.extynt.sidecar";
constexpr int kKickstartTimeoutMs = 5000;

#ifndef _WIN32
// {"launchctl", "kickstart", "gui/<uid>/<label>"}: no -k, so a sidecar that is already running is left alone.
std::vector<std::string> kickstartArguments(uid_t uid, const std::string& label);
#endif

// {"schtasks.exe", "/Run", "/TN", "<task>"}: the task's own policy ignores a second instance, so a running sidecar is
// left alone, like the launchctl form without -k.
std::vector<std::string> schtasksArguments(const std::string& task);

// The Windows sidecar task of one account: "extynt sidecar " then the account name, each character outside
// [A-Za-z0-9._-] (per UTF-16 unit) as '_'. Task names are machine-wide, so every account has its own;
// packaging/windows/common.ps1 agrees.
std::string sidecarTaskName(const std::wstring& account);

// One command line for CreateProcessW from argv: each argument quoted by the rules CommandLineToArgvW reverses.
std::string windowsCommandLine(const std::vector<std::string>& arguments);

// The outcome of one kickstart: `timedOut` when the child was killed after the timeout (or at join), `exitCode` its
// exit status (-1 when it did not exit normally), `error` why the spawn failed.
struct KickstartResult {
  bool spawned = false;
  bool timedOut = false;
  int exitCode = -1;
  std::string error;
};

class Kickstart {
 public:
  using Done = std::function<void(const KickstartResult&)>;

  explicit Kickstart(int timeoutMs = kKickstartTimeoutMs) : timeoutMs_(timeoutMs) {}
  ~Kickstart();
  Kickstart(const Kickstart&) = delete;
  Kickstart& operator=(const Kickstart&) = delete;
  Kickstart(Kickstart&&) = delete;
  Kickstart& operator=(Kickstart&&) = delete;

  // Spawns `program` with `arguments` (argv[0] included) on a new thread and returns at once. `done` runs on that
  // thread when the child ended. Starting twice is ignored.
  void start(const std::string& program, const std::vector<std::string>& arguments, Done done = nullptr);
  // Cancels a child still running (it is killed) and waits for the thread. Safe to call more than once.
  void join();

 private:
  void supervise(ChildProcess& child, KickstartResult& result);
  void run(const std::string& program, const std::vector<std::string>& arguments, const Done& done);
  void entry(const std::string& program, const std::vector<std::string>& arguments, const Done& done) noexcept;
  bool waitOrCancel(int pollMs);

  int timeoutMs_;
  std::mutex mutex_;
  std::condition_variable wake_;
  bool cancelled_ = false;
  bool started_ = false;
  std::thread thread_;
};

}

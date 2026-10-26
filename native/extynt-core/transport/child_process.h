// One short-lived child process the plugin starts and then waits for or kills (the sidecar kickstart). Implemented in
// child_process_posix.cpp and child_process_win.cpp. No SDK.
#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace extynt {

enum class ChildState : std::uint8_t { Running, Exited, Lost };

class ChildProcess {
 public:
  ChildProcess();
  ~ChildProcess();
  ChildProcess(const ChildProcess&) = delete;
  ChildProcess& operator=(const ChildProcess&) = delete;
  ChildProcess(ChildProcess&&) = delete;
  ChildProcess& operator=(ChildProcess&&) = delete;

  // Starts `program` with `arguments` (argv[0] included), an environment (a minimal fixed one on POSIX, the
  // caller's on Windows), no window and the standard streams on the null device. On failure `error` says why.
  bool spawn(const std::string& program, const std::vector<std::string>& arguments, std::string& error);
  // Non-blocking. Exited sets `exitCode` (-1 when the child did not exit normally); Lost means the system can no longer
  // tell (the child was reaped elsewhere).
  ChildState poll(int& exitCode);
  // Kills a child that is still running and reaps it.
  void killAndReap();

 private:
  struct State;
  std::unique_ptr<State> state_;
};

}

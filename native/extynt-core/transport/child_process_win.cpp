// Starts the sidecar process with CreateProcessW on Windows; the child inherits the caller's whole environment,
// unlike the POSIX half.
#include <windows.h>

#include <memory>
#include <string>
#include <vector>

#include "child_process.h"
#include "launch_agent.h"
#include "windows_paths.h"

namespace extynt {

struct ChildProcess::State {
  HANDLE process = nullptr;
  State() = default;
  State(const State&) = delete;
  State& operator=(const State&) = delete;
  State(State&&) = delete;
  State& operator=(State&&) = delete;
  ~State() {
    if (process != nullptr) ::CloseHandle(process);
  }
};

namespace {

HANDLE openNullDevice() {
  SECURITY_ATTRIBUTES inherit{};
  inherit.nLength = sizeof inherit;
  inherit.bInheritHandle = TRUE;
  return ::CreateFileW(L"NUL", GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, &inherit,
                       OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
}

}

ChildProcess::ChildProcess() : state_(std::make_unique<State>()) {}
ChildProcess::~ChildProcess() = default;

bool ChildProcess::spawn(const std::string& program, const std::vector<std::string>& arguments, std::string& error) {
  HANDLE nul = openNullDevice();
  if (nul == INVALID_HANDLE_VALUE) {
    error = "CreateFileW NUL: error " + std::to_string(::GetLastError());
    return false;
  }
  STARTUPINFOW startup{};
  startup.cb = sizeof startup;
  startup.dwFlags = STARTF_USESTDHANDLES;
  startup.hStdInput = nul;
  startup.hStdOutput = nul;
  startup.hStdError = nul;
  std::wstring commandLine = win::widen(windowsCommandLine(arguments));
  commandLine.push_back(L'\0');
  PROCESS_INFORMATION info{};
  const std::wstring application = win::widen(program);
  const BOOL started = ::CreateProcessW(application.c_str(), commandLine.data(), nullptr, nullptr, TRUE,
                                        CREATE_NO_WINDOW, nullptr, nullptr, &startup, &info);
  const DWORD failure = started != FALSE ? 0 : ::GetLastError();
  ::CloseHandle(nul);
  if (started == FALSE) {
    error = "CreateProcessW " + program + ": error " + std::to_string(failure);
    return false;
  }
  ::CloseHandle(info.hThread);
  state_->process = info.hProcess;
  return true;
}

ChildState ChildProcess::poll(int& exitCode) {
  const DWORD waited = ::WaitForSingleObject(state_->process, 0);
  if (waited == WAIT_TIMEOUT) return ChildState::Running;
  if (waited != WAIT_OBJECT_0) return ChildState::Lost;
  DWORD code = 0;
  exitCode = ::GetExitCodeProcess(state_->process, &code) != 0 ? static_cast<int>(code) : -1;
  return ChildState::Exited;
}

void ChildProcess::killAndReap() {
  ::TerminateProcess(state_->process, 1);
  ::WaitForSingleObject(state_->process, INFINITE);
}

}

// Windows half of ae_platform.h: the host version from the version resource of the process that loaded the plugin
// (After Effects' own exe), the CPU name, the Scheduled Task kickstart, and the catalogue engine's hiding and dialog
// guard. After Effects rewrites its command line to `AfterFX.exe -m` while it starts, so the launch's environment is
// read too. An effect that crashes the engine ends it at once, with the handler set again on every pass because After
// Effects installs its own while it starts, so its crash report window and Windows' error box never open on the
// user's desktop; the sidecar sees the engine gone and notes the effect. A modal dialog is never hidden (hidden, it
// would leave its owner disabled with nothing to cancel): the guard cancels it within a quarter second from a thread
// of its own, which also runs while the dialog's modal loop holds the main thread and keeps the plugin pinned.
#include <windows.h>
#include <shellapi.h>

#include <array>
#include <exception>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include "ae_dialog_scan_win.h"
#include "ae_host_executable_win.h"
#include "ae_log.h"
#include "ae_platform.h"
#include "host_mode.h"
#include "launch_agent.h"
#include "sdk_win_ae.h"
#include "sdk_win_module.h"
#include "sdk_win_window.h"
#include "windows_paths.h"

namespace extynt::ae {

namespace {

constexpr ULONGLONG kHideIntervalMs = 250;
constexpr DWORD kGuardIntervalMs = 250;

struct HideScan {
  DWORD pid = 0;
  DWORD thread = 0;
  int hidden = 0;
};

struct GuardState {
  HWND last = nullptr;
  int attempts = 0;
};

std::string versionText(const VS_FIXEDFILEINFO& info) {
  const unsigned major = HIWORD(info.dwFileVersionMS);
  const unsigned minor = LOWORD(info.dwFileVersionMS);
  const unsigned patch = HIWORD(info.dwFileVersionLS);
  const unsigned build = LOWORD(info.dwFileVersionLS);
  return std::to_string(major) + "." + std::to_string(minor) + "." + std::to_string(patch) + " (build " +
         std::to_string(build) + ")";
}

std::string fixedVersionOf(const std::wstring& path) {
  const std::optional<VS_FIXEDFILEINFO> info = sdkwin::fixedFileInfo(path);
  return info ? versionText(*info) : "";
}

std::string systemSchtasksPath() {
  std::array<wchar_t, MAX_PATH> directory{};
  const UINT length = GetSystemDirectoryW(directory.data(), static_cast<UINT>(directory.size()));
  if (length == 0 || length >= directory.size()) return "schtasks.exe";
  return win::narrow(std::wstring(directory.data(), length)) + "\\schtasks.exe";
}

void logKickstart(const std::string& task, const KickstartResult& result) {
  logLine(result.spawned ? "schtasks /Run \"" + task + "\": exit " + std::to_string(result.exitCode) +
                               (result.timedOut ? " (killed after the timeout)" : "")
                         : "schtasks /Run did not start: " + result.error);
}

std::string currentAccountTaskName() {
  std::array<wchar_t, 257> account{};
  auto length = static_cast<DWORD>(account.size());
  if (GetUserNameW(account.data(), &length) == FALSE) return sidecarTaskName(L"");
  return sidecarTaskName(account.data());
}

LONG WINAPI endEngineAtOnce(EXCEPTION_POINTERS* info) {
  const DWORD code = info != nullptr && info->ExceptionRecord != nullptr ? info->ExceptionRecord->ExceptionCode : 1;
  TerminateProcess(GetCurrentProcess(), code);
  return EXCEPTION_EXECUTE_HANDLER;
}

void silenceEngineCrashes() {
  static bool modeSet = false;
  if (!modeSet) {
    modeSet = true;
    SetErrorMode(GetErrorMode() | SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX);
  }
  SetUnhandledExceptionFilter(endEngineAtOnce);
}

bool isHideCandidate(HWND window, DWORD pid) {
  DWORD windowPid = 0;
  GetWindowThreadProcessId(window, &windowPid);
  if (windowPid != pid || IsWindowVisible(window) == FALSE || isDialogWindow(window)) return false;
  HWND owner = GetWindow(window, GW_OWNER);
  return owner == nullptr || IsWindowEnabled(owner) != FALSE;
}

void hideWindowOfThisThread(HWND window) {
  const LONG_PTR extended = GetWindowLongPtrW(window, GWL_EXSTYLE);
  const LONG_PTR wanted = (extended | WS_EX_TOOLWINDOW) & ~static_cast<LONG_PTR>(WS_EX_APPWINDOW);
  if (wanted != extended) SetWindowLongPtrW(window, GWL_EXSTYLE, wanted);
  ShowWindow(window, SW_HIDE);
}

void hideWindow(HideScan& scan, HWND window) {
  if (!isHideCandidate(window, scan.pid)) return;
  if (GetWindowThreadProcessId(window, nullptr) == scan.thread) {
    hideWindowOfThisThread(window);
  } else {
    ShowWindowAsync(window, SW_HIDE);
  }
  ++scan.hidden;
}

void dismissDialog(HWND dialog, int attempt) {
  if (attempt <= 1) {
    PostMessageW(dialog, WM_COMMAND, MAKEWPARAM(IDCANCEL, BN_CLICKED), 0);
  } else if (attempt == 2) {
    PostMessageW(dialog, WM_SYSCOMMAND, SC_CLOSE, 0);
  } else {
    PostMessageW(dialog, WM_CLOSE, 0, 0);
  }
}

void guardPass(GuardState& state) {
  HWND dialog = findModalDialogWindow();
  if (dialog == nullptr) {
    state = GuardState();
    return;
  }
  if (dialog != state.last) {
    state.last = dialog;
    state.attempts = 0;
    const std::string title = dialogTitle(dialog);
    logLine("engine: cancelled a dialog an effect opened: " + (title.empty() ? std::string("(untitled)") : title));
  }
  dismissDialog(dialog, ++state.attempts);
}

void guardLoop() noexcept {
  GuardState state;
  for (;;) {
    Sleep(kGuardIntervalMs);
    try {
      guardPass(state);
    } catch (...) {
      logDroppedException("engine dialog guard");
    }
  }
}

}

std::string hostVersionString() {
  const std::string version = fixedVersionOf(hostExecutablePath());
  return version.empty() ? "unknown" : version;
}

namespace {

bool engineEnvironmentSet() {
  std::array<wchar_t, 8> value{};
  const DWORD length =
      GetEnvironmentVariableW(win::widen(kEngineEnvironment).c_str(), value.data(), static_cast<DWORD>(value.size()));
  return length > 0 && length < value.size() && engineEnvironment(win::narrow(std::wstring(value.data(), length)));
}

}

bool hostIsHeadless() {
  if (engineEnvironmentSet()) return true;
  std::vector<std::string> arguments;
  for (const std::wstring& argument : sdkwin::processArguments()) arguments.push_back(win::narrow(argument));
  return headlessHost(arguments);
}

const char* hostArchitecture() {
#if defined(_M_ARM64) || defined(__aarch64__)
  return "arm64";
#else
  return "x86_64";
#endif
}

void startSidecar(Kickstart& kickstart) {
  const std::string task = currentAccountTaskName();
  kickstart.start(systemSchtasksPath(), schtasksArguments(task),
                  [task](const KickstartResult& result) { logKickstart(task, result); });
}

void keepEngineOutOfSight() {
  static ULONGLONG lastPass = 0;
  static bool logged = false;
  const ULONGLONG now = GetTickCount64();
  if (lastPass != 0 && now - lastPass < kHideIntervalMs) return;
  lastPass = now;
  silenceEngineCrashes();
  HideScan scan;
  scan.pid = GetCurrentProcessId();
  scan.thread = GetCurrentThreadId();
  sdkwin::forEachTopLevelWindow([&scan](HWND window) { hideWindow(scan, window); });
  if (scan.hidden > 0 && !logged) {
    logged = true;
    logLine("engine: hid " + std::to_string(scan.hidden) + " window(s) and took them off the taskbar");
  }
}

void startEngineDialogGuard() {
  static bool started = false;
  if (started) return;
  started = true;
  if (!sdkwin::pinModuleContaining(&guardLoop)) {
    logLine("engine: dialog guard not started (the plugin could not be pinned)");
    return;
  }
  try {
    std::thread(guardLoop).detach();
  } catch (const std::exception& error) {
    logLine(std::string("engine: dialog guard not started: ") + error.what());
    return;
  }
  logLine("engine: dialog guard on");
}

bool hostModalDialogOpen(const AEGP_UtilitySuite4& utility) {
  const std::optional<HWND> main = sdkwin::mainWindow(utility);
  return main && IsWindowEnabled(GetAncestor(*main, GA_ROOT)) == FALSE;
}

}

// The window scan behind the modal dialog probe and the engine's dialog guard. See ae_dialog_scan_win.h.
#include "ae_dialog_scan_win.h"

#include <windows.h>

#include <array>
#include <string>

#include "sdk_win_window.h"
#include "windows_paths.h"

namespace extynt::ae {

namespace {

constexpr UINT kTitleTimeoutMs = 150;
constexpr const wchar_t* kDialogClass = L"#32770";

struct Scan {
  DWORD pid = 0;
  HWND dialogClassWithDisabledOwner = nullptr;
  HWND otherWithDisabledOwner = nullptr;
  HWND ownerlessDialogClass = nullptr;
  bool anyDisabled = false;
};

bool isHelperWindow(HWND window) {
  const LONG_PTR extended = GetWindowLongPtrW(window, GWL_EXSTYLE);
  return (extended & (WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT)) != 0;
}

void noteCandidate(Scan& scan, HWND window) {
  HWND owner = GetWindow(window, GW_OWNER);
  const bool dialogClass = isDialogWindow(window);
  if (owner != nullptr && IsWindowEnabled(owner) == FALSE) {
    HWND& slot = dialogClass ? scan.dialogClassWithDisabledOwner : scan.otherWithDisabledOwner;
    if (slot == nullptr) slot = window;
  } else if (owner == nullptr && dialogClass && scan.ownerlessDialogClass == nullptr) {
    scan.ownerlessDialogClass = window;
  }
}

void classify(Scan& scan, HWND window) {
  if (IsWindowEnabled(window) == FALSE) {
    scan.anyDisabled = true;
    return;
  }
  if (!isHelperWindow(window)) noteCandidate(scan, window);
}

void visit(Scan& scan, HWND window) {
  DWORD pid = 0;
  GetWindowThreadProcessId(window, &pid);
  if (pid == scan.pid && IsWindowVisible(window) != FALSE) classify(scan, window);
}

}

bool isDialogWindow(HWND window) {
  std::array<wchar_t, 16> name{};
  const int length = GetClassNameW(window, name.data(), static_cast<int>(name.size()));
  return length > 0 && std::wstring(name.data(), static_cast<std::size_t>(length)) == kDialogClass;
}

HWND findModalDialogWindow() {
  Scan scan;
  scan.pid = GetCurrentProcessId();
  sdkwin::forEachTopLevelWindow([&scan](HWND window) { visit(scan, window); });
  HWND found =
      scan.dialogClassWithDisabledOwner != nullptr ? scan.dialogClassWithDisabledOwner : scan.otherWithDisabledOwner;
  if (found == nullptr && scan.anyDisabled) found = scan.ownerlessDialogClass;
  return found;
}

std::string dialogTitle(HWND dialog) { return win::narrow(sdkwin::windowTitleWithin(dialog, kTitleTimeoutMs)); }

}

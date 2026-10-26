// Window subclassing and the timed title read, the parts of sdk_win_window.h that are not templates.
#include "sdk_win_window.h"

#include <windows.h>

#include <shellapi.h>

#include <array>
#include <string>
#include <vector>

#include "ae_panel_win_panel.h"

namespace extynt::ae::sdkwin {

namespace {

const wchar_t* const kOriginalProc = L"extyntOriginalProc";
const wchar_t* const kPanelProp = L"extyntPanel";
constexpr std::size_t kMaxTitleChars = 256;

void (*&foregroundHandler())(HWND) noexcept {
  static void (*handler)(HWND) noexcept = nullptr;
  return handler;
}

void CALLBACK foregroundEvent([[maybe_unused]] HWINEVENTHOOK hook, [[maybe_unused]] DWORD event, HWND window,
                              [[maybe_unused]] LONG object, [[maybe_unused]] LONG child, [[maybe_unused]] DWORD thread,
                              [[maybe_unused]] DWORD time) noexcept {
  if (foregroundHandler() != nullptr) foregroundHandler()(window);
}

}

panel::WinPanel* hostPanel(HWND window) {
  return reinterpret_cast<panel::WinPanel*>(GetWindowLongPtrW(window, GWLP_USERDATA));
}

void bindHostPanel(HWND window, panel::WinPanel& panel) {
  SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(&panel));
}

void unbindHostPanel(HWND window) { SetWindowLongPtrW(window, GWLP_USERDATA, 0); }

panel::WinPanel* containerPanel(HWND window) {
  return reinterpret_cast<panel::WinPanel*>(GetPropW(window, kPanelProp));
}

void bindContainerPanel(HWND window, panel::WinPanel& panel) {
  SetPropW(window, kPanelProp, reinterpret_cast<HANDLE>(&panel));
}

void unbindContainerPanel(HWND window) { RemovePropW(window, kPanelProp); }

MINMAXINFO* minMaxInfo(LPARAM parameter) { return reinterpret_cast<MINMAXINFO*>(parameter); }

MSG* hookedMessage(LPARAM parameter) { return reinterpret_cast<MSG*>(parameter); }

WNDPROC subclassedOriginal(HWND window) { return reinterpret_cast<WNDPROC>(GetPropW(window, kOriginalProc)); }

void subclassWindow(HWND window, WNDPROC procedure) {
  if (GetPropW(window, kOriginalProc) != nullptr) return;
  SetLastError(0);
  const LONG_PTR previous = SetWindowLongPtrW(window, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(procedure));
  if (previous != 0 || GetLastError() == 0) SetPropW(window, kOriginalProc, reinterpret_cast<HANDLE>(previous));
}

void releaseSubclass(HWND window, WNDPROC procedure) {
  const LONG_PTR current = GetWindowLongPtrW(window, GWLP_WNDPROC);
  if (current == reinterpret_cast<LONG_PTR>(procedure)) {
    SetWindowLongPtrW(window, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(subclassedOriginal(window)));
    RemovePropW(window, kOriginalProc);
  }
}

std::wstring windowTitleWithin(HWND window, UINT timeoutMs) {
  std::array<wchar_t, kMaxTitleChars> text{};
  DWORD_PTR copied = 0;
  const LRESULT sent =
      SendMessageTimeoutW(window, WM_GETTEXT, static_cast<WPARAM>(text.size() - 1),
                          reinterpret_cast<LPARAM>(text.data()), SMTO_ABORTIFHUNG | SMTO_BLOCK, timeoutMs, &copied);
  if (sent == 0) return {};
  return {text.data(), static_cast<std::size_t>(copied)};
}

HWINEVENTHOOK startForegroundWatch(void (*handler)(HWND window) noexcept) {
  foregroundHandler() = handler;
  return SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, nullptr, foregroundEvent, 0, 0,
                         WINEVENT_OUTOFCONTEXT);
}

void stopForegroundWatch(HWINEVENTHOOK watch) {
  UnhookWinEvent(watch);
  foregroundHandler() = nullptr;
}

std::vector<std::wstring> processArguments() {
  std::vector<std::wstring> arguments;
  int count = 0;
  LPWSTR* const values = CommandLineToArgvW(GetCommandLineW(), &count);
  if (values == nullptr) return arguments;
  for (int i = 0; i < count; ++i) arguments.emplace_back(values[i]);
  LocalFree(reinterpret_cast<HLOCAL>(values));
  return arguments;
}

}

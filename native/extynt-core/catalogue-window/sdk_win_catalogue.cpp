// The conversions of sdk_win_catalogue.h.
#include "sdk_win_catalogue.h"

#include <windows.h>

#include <cstdint>

#include "catalogue_program.h"

namespace extynt::catalogue::sdkcatalogue {

namespace {

constexpr UINT kDefaultDpi = 96;

FARPROC user32Export(const char* name) {
  const HMODULE user32 = GetModuleHandleW(L"user32.dll");
  return user32 != nullptr ? GetProcAddress(user32, name) : nullptr;
}

}

RECT dpiSuggestedRect(LPARAM parameter) { return *reinterpret_cast<const RECT*>(parameter); }

void enablePerMonitorDpiAwareness() {
  using SetContext = BOOL(WINAPI*)(DPI_AWARENESS_CONTEXT);
  const auto set =
      reinterpret_cast<SetContext>(reinterpret_cast<void (*)()>(user32Export("SetProcessDpiAwarenessContext")));
  if (set != nullptr) set(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
}

UINT dpiOfWindow(HWND window) {
  using GetDpi = UINT(WINAPI*)(HWND);
  const auto get = reinterpret_cast<GetDpi>(reinterpret_cast<void (*)()>(user32Export("GetDpiForWindow")));
  const UINT dpi = get != nullptr ? get(window) : 0;
  return dpi != 0 ? dpi : kDefaultDpi;
}

bool adjustWindowRectForDpi(RECT& outer, DWORD style, DWORD exStyle, UINT dpi) {
  using AdjustForDpi = BOOL(WINAPI*)(LPRECT, DWORD, BOOL, DWORD, UINT);
  const auto adjust =
      reinterpret_cast<AdjustForDpi>(reinterpret_cast<void (*)()>(user32Export("AdjustWindowRectExForDpi")));
  return adjust != nullptr && adjust(&outer, style, FALSE, exStyle, dpi) != FALSE;
}

void setControlFont(HWND control, HFONT font) {
  SendMessageW(control, WM_SETFONT, reinterpret_cast<WPARAM>(font), TRUE);
}

void freeArguments(LPWSTR* arguments) { LocalFree(reinterpret_cast<HLOCAL>(arguments)); }

HWND createDefaultButton(HWND parent, const wchar_t* text, int id) {
  return CreateWindowExW(0, L"BUTTON", text, WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_DEFPUSHBUTTON, 0, 0, 10, 10,
                         parent, reinterpret_cast<HMENU>(static_cast<std::uintptr_t>(id)), nullptr, nullptr);
}

HWND createPushButton(HWND parent, const wchar_t* text, int id) {
  return CreateWindowExW(0, L"BUTTON", text, WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_PUSHBUTTON, 0, 0, 10, 10, parent,
                         reinterpret_cast<HMENU>(static_cast<std::uintptr_t>(id)), nullptr, nullptr);
}

}

int WINAPI wWinMain(HINSTANCE hInstance, [[maybe_unused]] HINSTANCE hPrevInstance, [[maybe_unused]] LPWSTR lpCmdLine,
                    [[maybe_unused]] int nShowCmd) {
  extynt::catalogue::sdkcatalogue::enablePerMonitorDpiAwareness();
  return extynt::catalogue::runCatalogueProgram(hInstance);
}

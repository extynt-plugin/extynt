// The Win32 calls of the catalogue window that need an integer made into a pointer or a pointer into an integer, a
// control id set at creation, or a function that older Windows lacks. The conversions exist only here.
#pragma once

#include <windows.h>

namespace extynt::catalogue::sdkcatalogue {

// The `T` that CreateWindowExW was given as its last argument, read from the WM_NCCREATE parameter.
template <typename T>
T* creationInstance(LPARAM parameter) {
  return static_cast<T*>(reinterpret_cast<const CREATESTRUCTW*>(parameter)->lpCreateParams);
}

// Keeps `instance` with `window` for later messages; storedInstance returns it, or null before it was stored.
template <typename T>
void storeInstance(HWND window, T* instance) {
  SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(instance));
}

template <typename T>
T* storedInstance(HWND window) {
  return reinterpret_cast<T*>(GetWindowLongPtrW(window, GWLP_USERDATA));
}

// The monitor-sized rectangle a WM_DPICHANGED message suggests for the window.
RECT dpiSuggestedRect(LPARAM parameter);

// Makes the process per-monitor DPI aware (V2) where Windows has the call (1703 and later); otherwise does nothing.
void enablePerMonitorDpiAwareness();

// The DPI of `window`, or 96 where Windows has no per-window DPI (before 1607).
UINT dpiOfWindow(HWND window);

// Turns the client size in `outer` into the window size for `style`, `exStyle` and `dpi`; false where Windows lacks
// the call (before 1607), leaving `outer` as it was.
bool adjustWindowRectForDpi(RECT& outer, DWORD style, DWORD exStyle, UINT dpi);

// Frees the array CommandLineToArgvW returned.
void freeArguments(LPWSTR* arguments);

// Sets the font of a control and repaints it.
void setControlFont(HWND control, HFONT font);

// A visible, tab-stop push button child of `parent` whose id is `id` from the moment it exists.
HWND createDefaultButton(HWND parent, const wchar_t* text, int id);

// The same, a plain push button (not the window's default one), for an action that is not the one Enter takes.
HWND createPushButton(HWND parent, const wchar_t* text, int id);

}

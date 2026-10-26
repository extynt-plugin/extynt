// Typed views of the untyped values Win32 window code passes around: the panel a window belongs to, the structures
// window messages carry in LPARAM, window enumeration, the previous window procedure of a subclassed window and text
// fetched with a timed WM_GETTEXT. The integer-to-pointer conversions exist only here.
#pragma once

#include <windows.h>

#include <exception>
#include <string>
#include <vector>

namespace extynt::ae::panel {
class WinPanel;
}

namespace extynt::ae::sdkwin {

// The panel whose host window is `window` (kept in its user data), or null when none was bound.
panel::WinPanel* hostPanel(HWND window);

// Binds `window` to `panel` as its host window; the window never owns the panel.
void bindHostPanel(HWND window, panel::WinPanel& panel);

void unbindHostPanel(HWND window);

// The panel whose container is `window` (kept in a window property), or null when none was bound.
panel::WinPanel* containerPanel(HWND window);

void bindContainerPanel(HWND window, panel::WinPanel& panel);

void unbindContainerPanel(HWND window);

// The MINMAXINFO a WM_GETMINMAXINFO message carries.
MINMAXINFO* minMaxInfo(LPARAM parameter);

// The MSG a WH_GETMESSAGE hook receives.
MSG* hookedMessage(LPARAM parameter);

// Calls `visitor(window)` for every top-level window; the visitor runs on the calling thread. An exception it throws
// stops the enumeration and is rethrown here, never across the Windows callback.
template <typename Visitor>
void forEachTopLevelWindow(const Visitor& visitor) {
  struct Visit {
    const Visitor* callable = nullptr;
    std::exception_ptr error;
  } visit{&visitor, nullptr};
  EnumWindows(
      [](HWND window, LPARAM parameter) noexcept -> BOOL {
        auto& state = *reinterpret_cast<Visit*>(parameter);
        try {
          (*state.callable)(window);
        } catch (...) {
          state.error = std::current_exception();
          return FALSE;
        }
        return TRUE;
      },
      reinterpret_cast<LPARAM>(&visit));
  if (visit.error) std::rethrow_exception(visit.error);
}

// Replaces the window procedure of `window` unless it was subclassed already; the previous one is kept as a property.
void subclassWindow(HWND window, WNDPROC procedure);

// The window procedure `window` had before subclassWindow, or null.
WNDPROC subclassedOriginal(HWND window);

// Puts the previous procedure back unless something else subclassed on top of `procedure`.
void releaseSubclass(HWND window, WNDPROC procedure);

// Calls `handler(window)` on the calling thread each time another top-level window becomes the foreground window;
// null when the watch could not be installed. Stop it with stopForegroundWatch.
HWINEVENTHOOK startForegroundWatch(void (*handler)(HWND window) noexcept);
void stopForegroundWatch(HWINEVENTHOOK watch);

// The process command line split into arguments, the program name first.
std::vector<std::wstring> processArguments();

// The window's title, fetched with a WM_GETTEXT that gives up after `timeoutMs`; empty when it does not answer.
std::wstring windowTitleWithin(HWND window, UINT timeoutMs);

}

// Windows only. State shared by the files of the WebView2 panel: the flyout switches, the live panels, and the host
// facts (theme, floating-window limits) the AEGP half supplies. Main thread only, except the atomics.
#pragma once

#include <windows.h>

#include <atomic>
#include <optional>

#include "panel_theme.h"

namespace extynt::ae::panel {

// The smallest size a panel window is allowed (pixels): the first snap size, and the floor for a floating window.
constexpr int kPanelMinimumWidth = 260;
constexpr int kPanelMinimumHeight = 320;

// Flyout: "Log keys" and "Key hook" (the main-thread message hook), both off by default, and "Force shortcuts" (on by
// default: the web view's AcceleratorKeyPressed event puts edit shortcuts and navigation keys in front of the page and
// keeps After Effects from taking them). All switchable so a test can compare.
struct PanelFlags {
  std::atomic<bool> logKeys{false};
  std::atomic<bool> keyHook{false};
  std::atomic<bool> keyForce{true};
  std::atomic<int> createCount{0};
};
PanelFlags& panelFlags();

// Starts COM on the calling (main) thread the first time it is asked and returns that call's HRESULT every time
// (RPC_E_CHANGED_MODE is usable: the thread already has another apartment). stopCom balances it when the plugin
// unloads.
HRESULT startComOnce();
void stopCom();

// AE's UI background (PF_AppGetBgColor) as a theme, nothing when the suite is missing or the call fails. Main thread.
std::optional<HostTheme> currentHostTheme();

// True for a window that is After Effects' main frame; false for a floating panel window or when AE does not say.
bool isMainFrameWindow(HWND window);

}

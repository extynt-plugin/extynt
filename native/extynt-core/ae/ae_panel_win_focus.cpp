// The foreground watch. After Alt+Tab away and back the page still shows its focus ring, but Windows (or After Effects)
// has put the keyboard focus on another window, so Ctrl+V reaches After Effects. The watch runs on the thread that
// installed it, so every panel is told on the main thread.
#include "ae_panel_win_focus.h"

#include <windows.h>

#include <memory>
#include <string>

#include "ae_log.h"
#include "ae_panel_win_panel.h"
#include "sdk_win_window.h"

namespace extynt::ae::panel {

namespace {

HWINEVENTHOOK& watchHandle() {
  static HWINEVENTHOOK watch = nullptr;
  return watch;
}

void foregroundChanged(HWND window) noexcept {
  try {
    for (const std::unique_ptr<WinPanel>& panel : livePanels()) {
      if (panel->alive()) panel->foregroundChanged(window);
    }
  } catch (...) {
    logDroppedException("foreground watch");
  }
}

}

void installForegroundWatch() {
  if (watchHandle() != nullptr) return;
  watchHandle() = sdkwin::startForegroundWatch(foregroundChanged);
  if (watchHandle() == nullptr)
    logLine("panel: foreground watch install failed, error " + std::to_string(GetLastError()));
}

void removeForegroundWatch() {
  if (watchHandle() == nullptr) return;
  sdkwin::stopForegroundWatch(watchHandle());
  watchHandle() = nullptr;
}

}

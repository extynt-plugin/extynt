// Typed handles for the After Effects SDK on Windows: panel refcons that carry our own objects, and the main window
// the utility suite reports through an untyped out parameter.
#pragma once

#include <windows.h>

#include <optional>

#include "AE_GeneralPlugPanels.h"
#include "ae_sdk.h"

namespace extynt::ae::panel {
class WinPanel;
}

namespace extynt::ae::sdkwin {

// The refcon that hands `panel` back to the panel callbacks; the host never owns or reads it.
AEGP_PanelRefcon panelRefcon(panel::WinPanel& panel);

// The panel a refcon was made from, or null for no refcon.
panel::WinPanel* panelOfRefcon(AEGP_PanelRefcon refcon);

// After Effects' main window according to `utility`; nothing when the suite cannot say or reports none.
template <typename Suite>
std::optional<HWND> mainWindow(const Suite& utility) {
  HWND main = nullptr;
  if (!utility.AEGP_GetMainHWND || utility.AEGP_GetMainHWND(&main) != A_Err_NONE || main == nullptr) {
    return std::nullopt;
  }
  return main;
}

}

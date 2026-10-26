// The panel refcon conversions of sdk_win_ae.h.
#include "sdk_win_ae.h"

#include "ae_panel_win_panel.h"

namespace extynt::ae::sdkwin {

AEGP_PanelRefcon panelRefcon(panel::WinPanel& panel) { return reinterpret_cast<AEGP_PanelRefcon>(&panel); }

panel::WinPanel* panelOfRefcon(AEGP_PanelRefcon refcon) { return reinterpret_cast<panel::WinPanel*>(refcon); }

}

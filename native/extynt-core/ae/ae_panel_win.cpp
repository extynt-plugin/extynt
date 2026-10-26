// Windows half of the native panel (WebView2): the AEGP hooks, the flyout, the registration and the host theme,
// following the SDK Panelator sample as the macOS half does. The window, view, load, menu and key code live in the
// ae_panel_win_*.cpp files; every AEGP hook here is noexcept so no C++ exception reaches After Effects. The app and
// utility suites are optional, and key logging and the message hook are for test runs only.
#include <windows.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "AE_GeneralPlugPanels.h"
#include "ae_hook_adapter.h"
#include "ae_log.h"
#include "ae_panel.h"
#include "ae_panel_win.h"
#include "ae_panel_win_focus.h"
#include "ae_panel_win_keys.h"
#include "ae_panel_win_panel.h"
#include "panel_theme.h"
#include "sdk_panel_suite_ids.h"
#include "sdk_suite_ids.h"
#include "sdk_suites.h"
#include "sdk_text.h"
#include "sdk_win_ae.h"
#include "sdk_win_window.h"

namespace extynt::ae::panel {

PanelFlags& panelFlags() {
  static PanelFlags flags;
  return flags;
}

namespace {

std::optional<HRESULT>& comResult() {
  static std::optional<HRESULT> result;
  return result;
}

}

HRESULT startComOnce() {
  std::optional<HRESULT>& result = comResult();
  if (!result.has_value()) result = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  return result.value();
}

void stopCom() {
  std::optional<HRESULT>& result = comResult();
  if (result.has_value() && SUCCEEDED(result.value())) CoUninitialize();
  result.reset();
}

}

namespace {

using extynt::ae::logDroppedException;
using extynt::ae::logLine;
using extynt::ae::sdkText;
using namespace extynt::ae::panel;

const char* const kMenuName = "extynt";
const char* const kMatchName = "extynt";

constexpr A_long kMinimumWidth = kPanelMinimumWidth;
constexpr A_long kPreferredWidth = 360;
constexpr A_long kPreferredHeight = 640;
constexpr A_long kSnapSizeCount = 2;

constexpr AEGP_FlyoutMenuCmdID kFlyoutReload = 31;
constexpr AEGP_FlyoutMenuCmdID kFlyoutLogKeys = 32;
constexpr AEGP_FlyoutMenuCmdID kFlyoutKeyHook = 33;
constexpr AEGP_FlyoutMenuCmdID kFlyoutKeyForce = 34;

struct PanelState {
  const SPBasicSuite* basic = nullptr;
  const AEGP_CommandSuite1* command = nullptr;
  const AEGP_PanelSuite1* panel = nullptr;
  const PFAppSuite4* app = nullptr;
  const AEGP_UtilitySuite6* utility = nullptr;
  AEGP_Command menuCommand = 0;
  std::vector<extynt::ae::SuiteStatus> statuses;
};
PanelState& panelState() {
  static PanelState state;
  return state;
}

A_Err getSnapSizes([[maybe_unused]] AEGP_PanelRefcon refcon, A_LPoint* snapSizes, A_long* numSizes) noexcept {
  snapSizes[0].x = kMinimumWidth;
  snapSizes[0].y = kPanelMinimumHeight;
  snapSizes[1].x = kPreferredWidth;
  snapSizes[1].y = kPreferredHeight;
  *numSizes = kSnapSizeCount;
  return A_Err_NONE;
}

AEGP_FlyoutMenuItem flyoutItem(AEGP_FlyoutMenuCmdID id, const char* label, bool checked) {
  return {1, checked ? AEGP_FlyoutMenuMarkType_CHECKED : AEGP_FlyoutMenuMarkType_NORMAL, TRUE, id, sdkText(label)};
}

A_Err populateFlyout([[maybe_unused]] AEGP_PanelRefcon refcon, AEGP_FlyoutMenuItem* items,
                     A_long* inOutCount) noexcept {
  const std::array<AEGP_FlyoutMenuItem, 4> table = {{
      flyoutItem(kFlyoutLogKeys, "Log keys", panelFlags().logKeys.load()),
      flyoutItem(kFlyoutKeyHook, "Key hook (main-thread message hook)", panelFlags().keyHook.load()),
      flyoutItem(kFlyoutKeyForce, "Force shortcuts and arrows to the page", panelFlags().keyForce.load()),
      flyoutItem(kFlyoutReload, "Reload page", false),
  }};
  const auto count = static_cast<A_long>(table.size());
  const auto copied = std::min(count, *inOutCount);
  std::copy_n(table.begin(), copied, items);
  *inOutCount = count;
  return A_Err_NONE;
}

void toggle(std::atomic<bool>& flag, const char* name) {
  const bool now = !flag.load();
  logLine(std::string("panel: ") + name + (now ? " ON" : " OFF"));
  flag.store(now);
}

void runFlyoutCommand(AEGP_PanelRefcon refcon, AEGP_FlyoutMenuCmdID commandId) {
  if (commandId == kFlyoutLogKeys) {
    toggle(panelFlags().logKeys, "log keys");
  } else if (commandId == kFlyoutKeyHook) {
    toggle(panelFlags().keyHook, "key hook");
  } else if (commandId == kFlyoutKeyForce) {
    toggle(panelFlags().keyForce, "force shortcuts");
  } else if (commandId == kFlyoutReload && refcon) {
    extynt::ae::sdkwin::panelOfRefcon(refcon)->reloadFromFlyout();
  }
}

A_Err doFlyoutCommand(AEGP_PanelRefcon refcon, AEGP_FlyoutMenuCmdID commandId) noexcept {
  try {
    runFlyoutCommand(refcon, commandId);
  } catch (...) {
    logDroppedException("flyout command");
  }
  return A_Err_NONE;
}

struct CreatePanelCall {
  AEGP_GlobalRefcon global;
  AEGP_CreatePanelRefcon refcon;
  AEGP_PlatformViewRef container;
  AEGP_PanelH panel;
  AEGP_PanelFunctions1* table;
  AEGP_PanelRefcon* outRefcon;
};

void createPanel(const CreatePanelCall& call) {
  const int count = ++panelFlags().createCount;
  logLine("panel: create #" + std::to_string(count) + " (container " + (call.container ? "present" : "NULL") + ")");
  call.table->GetSnapSizes = getSnapSizes;
  call.table->PopulateFlyout = populateFlyout;
  call.table->DoFlyoutCommand = doFlyoutCommand;
  if (!call.container) return;
  std::unique_ptr<WinPanel> panel = std::make_unique<WinPanel>(call.container, call.panel);
  if (panelState().panel) panelState().panel->AEGP_SetTitle(call.panel, sdkText(kMenuName));
  *call.outRefcon = extynt::ae::sdkwin::panelRefcon(*panel);
  livePanels().push_back(std::move(panel));
  livePanels().back()->open();
}

struct CommandCall {
  AEGP_GlobalRefcon global;
  AEGP_CommandRefcon refcon;
  AEGP_Command command;
  AEGP_HookPriority priority;
  A_Boolean alreadyHandled;
  A_Boolean* handled;
};

void runMenuCommand(const CommandCall& call) {
  if (call.command != panelState().menuCommand || !panelState().panel) return;
  const A_Err err = panelState().panel->AEGP_ToggleVisibility(sdkText(kMatchName));
  logLine("panel: Window menu command -> ToggleVisibility, AEGP error " + std::to_string(err));
  if (call.handled) *call.handled = TRUE;
}

A_Err updateMenuHook([[maybe_unused]] AEGP_GlobalRefcon global, [[maybe_unused]] AEGP_UpdateMenuRefcon menu,
                     [[maybe_unused]] AEGP_WindowType window) noexcept {
  if (!panelState().command || !panelState().panel) return A_Err_NONE;
  try {
    panelState().command->AEGP_EnableCommand(panelState().menuCommand);
    A_Boolean shown = FALSE;
    A_Boolean frontmost = FALSE;
    if (panelState().panel->AEGP_IsShown(sdkText(kMatchName), &shown, &frontmost) == A_Err_NONE) {
      panelState().command->AEGP_CheckMarkMenuCommand(panelState().menuCommand,
                                                      (shown != FALSE && frontmost != FALSE) ? TRUE : FALSE);
    }
  } catch (...) {
    logDroppedException("menu update");
  }
  return A_Err_NONE;
}

template <typename Suite>
extynt::ae::SuiteStatus acquire(const SPBasicSuite& basic, const char* key, const extynt::ae::SuiteId<Suite>& id,
                                const Suite*& slot) {
  extynt::ae::SuiteStatus status;
  status.key = key;
  status.sdkName = id.name;
  status.requested = id.version;
  if (extynt::ae::acquireSuite(basic, id, slot, status.error)) status.acquired = id.version;
  return status;
}

A_Err registerPanelHooks(AEGP_PluginID pluginId, const AEGP_RegisterSuite5* registrar) {
  A_Err err = panelState().command->AEGP_GetUniqueCommand(&panelState().menuCommand);
  if (err == A_Err_NONE) {
    err = panelState().command->AEGP_InsertMenuCommand(panelState().menuCommand, kMenuName, AEGP_Menu_WINDOW,
                                                       AEGP_MENU_INSERT_SORTED);
  }
  if (err == A_Err_NONE) {
    err = registrar->AEGP_RegisterCommandHook(
        pluginId, AEGP_HP_BeforeAE, panelState().menuCommand,
        extynt::ae::HookAdapter<AEGP_CommandHook>::run<CommandCall, runMenuCommand>, nullptr);
  }
  if (err == A_Err_NONE) err = registrar->AEGP_RegisterUpdateMenuHook(pluginId, updateMenuHook, nullptr);
  if (err == A_Err_NONE) {
    err = panelState().panel->AEGP_RegisterCreatePanelHook(
        pluginId, sdkText(kMatchName), extynt::ae::HookAdapter<AEGP_CreatePanelHook>::run<CreatePanelCall, createPanel>,
        nullptr, TRUE);
  }
  return err;
}

void acquirePanelSuites(const SPBasicSuite& basic) {
  panelState().statuses.push_back(acquire(basic, "command", extynt::ae::suite::kCommand, panelState().command));
  panelState().statuses.push_back(acquire(basic, "panel", extynt::ae::suite::kPanel, panelState().panel));
  panelState().statuses.push_back(acquire(basic, "app", extynt::ae::suite::kApp, panelState().app));
  acquire(basic, "utility", extynt::ae::suite::kUtility6, panelState().utility);
}

}

namespace extynt::ae::panel {

std::optional<HostTheme> currentHostTheme() {
  if (!panelState().app || !panelState().app->PF_AppGetBgColor) return std::nullopt;
  PF_App_Color color = {0, 0, 0};
  if (panelState().app->PF_AppGetBgColor(&color) != PF_Err_NONE) return std::nullopt;
  HostTheme theme = hostThemeFromAppColor(color.red, color.green, color.blue);
  static unsigned lastRaw = ~0U;
  const unsigned raw =
      (static_cast<unsigned>(color.red) << 16) ^ (static_cast<unsigned>(color.green) << 8) ^ color.blue;
  if (raw != lastRaw) {
    lastRaw = raw;
    logLine("panel: AE background colour raw (" + std::to_string(color.red) + ", " + std::to_string(color.green) +
            ", " + std::to_string(color.blue) + ") -> " + theme.background + " luminance " +
            std::to_string(theme.luminance));
  }
  return theme;
}

bool isMainFrameWindow(HWND window) {
  if (!panelState().utility) return false;
  const std::optional<HWND> main = sdkwin::mainWindow(*panelState().utility);
  return main && (GetAncestor(*main, GA_ROOT) == window || *main == window);
}

}

namespace extynt::ae {

std::vector<SuiteStatus> registerNativePanel(const SPBasicSuite* basic, AEGP_PluginID pluginId,
                                             const AEGP_RegisterSuite5* registrar) {
  panelState() = PanelState();
  panelState().basic = basic;
  if (!basic || !registrar) return {};
  try {
    acquirePanelSuites(*basic);
    if (!panelState().command || !panelState().panel) {
      logLine("panel: suites missing, the native panel is not registered");
      return panelState().statuses;
    }
    const A_Err err = registerPanelHooks(pluginId, registrar);
    logLine(err != A_Err_NONE ? "panel: registration failed, AEGP error " + std::to_string(err)
                              : "panel: registered (Window > " + std::string(kMenuName) + ", match name extynt)");
    panel::installKeyHook();
    panel::installForegroundWatch();
  } catch (...) {
    logLine("panel: registration threw");
  }
  return panelState().statuses;
}

void releaseNativePanel(const SPBasicSuite* basic) {
  panel::removeKeyHook();
  panel::removeForegroundWatch();
  for (const std::unique_ptr<panel::WinPanel>& panel : panel::livePanels()) panel->close();
  panel::unregisterHostClass();
  panel::stopCom();
  if (!basic) return;
  for (const SuiteStatus& status : panelState().statuses) {
    if (status.acquired != 0) basic->ReleaseSuite(status.sdkName.c_str(), status.acquired);
  }
  if (panelState().utility) basic->ReleaseSuite(kAEGPUtilitySuite, kAEGPUtilitySuiteVersion6);
  panelState() = PanelState();
}

}

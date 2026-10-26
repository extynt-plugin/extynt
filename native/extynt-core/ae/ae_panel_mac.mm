// macOS half of the native panel: the Window menu command, the panel hooks that host a WKWebView in AE's panel view,
// the flyout, and the theme read from AE's UI colour. Compiled with ARC; the page itself is ae_panel_view.mm and key
// routing is ae_panel_monitor.mm.
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

#include <atomic>
#include <optional>
#include <string>
#include <vector>

#include "AE_GeneralPlugPanels.h"
#include "ae_log.h"
#include "ae_panel.h"
#include "ae_panel_diag.h"
#include "ae_panel_monitor.h"
#include "panel_page.h"
#include "ae_panel_view.h"
#include "ae_platform.h"
#include "ae_suites.h"
#include "sdk_cocoa.h"
#include "sdk_panel_suite_ids.h"
#include "sdk_suite_ids.h"
#include "sdk_suites.h"
#include "sdk_text.h"
#include "library_files.h"

#ifndef EXTYNT_PLUGIN_VERSION
#define EXTYNT_PLUGIN_VERSION "0.0.0-dev"
#endif

namespace {

using extynt::ae::logDroppedException;
using extynt::ae::logLine;
using namespace extynt::ae::panel;

const A_u_char* const kMatchName = extynt::ae::sdkText("extynt");
const char* const kMenuName = "extynt";

const A_long kMinimumWidth = kPanelMinimumWidth;
const A_long kPreferredWidth = 360;

enum FlyoutCommand { kFlyoutReload = 31, kFlyoutLogKeys = 32 };

struct PanelState {
  const SPBasicSuite* basic = nullptr;
  const AEGP_CommandSuite1* command = nullptr;
  const AEGP_PanelSuite1* panel = nullptr;
  const PFAppSuite4* app = nullptr;
  AEGP_Command menuCommand = 0;
  std::vector<extynt::ae::SuiteStatus> statuses;
};
PanelState g_state;

A_Err getSnapSizes(AEGP_PanelRefcon, A_LPoint* snapSizes, A_long* numSizes) noexcept {
  snapSizes[0].x = kMinimumWidth;
  snapSizes[0].y = kPanelMinimumHeight;
  snapSizes[1].x = kPreferredWidth;
  snapSizes[1].y = 640;
  *numSizes = 2;
  return A_Err_NONE;
}

A_Err populateFlyout(AEGP_PanelRefcon, AEGP_FlyoutMenuItem* items, A_long* inOutCount) noexcept {
  const AEGP_FlyoutMenuItem table[] = {
      {1, g_logKeys.load() ? AEGP_FlyoutMenuMarkType_CHECKED : AEGP_FlyoutMenuMarkType_NORMAL, TRUE, kFlyoutLogKeys,
       extynt::ae::sdkText("Log keys")},
      {1, AEGP_FlyoutMenuMarkType_NORMAL, TRUE, kFlyoutReload, extynt::ae::sdkText("Reload page")},
  };
  const A_long count = sizeof table / sizeof table[0];
  for (A_long i = 0; i < count && i < *inOutCount; ++i) items[i] = table[i];
  *inOutCount = count;
  return A_Err_NONE;
}

void runFlyoutCommand(AEGP_PanelRefcon refcon, AEGP_FlyoutMenuCmdID commandId) {
  if (commandId == kFlyoutLogKeys) {
    const bool now = !g_logKeys.load();
    logLine(std::string("panel: log keys ") + (now ? "ON" : "OFF"));
    g_logKeys.store(now);
  } else if (commandId == kFlyoutReload && refcon) {
    extyntPanel* panel = extynt::ae::panelFromRefcon(refcon);
    logLine("panel: reload requested from the flyout");
    [panel loadPage];
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

void registerQuietWebDefaults() {
  [[NSUserDefaults standardUserDefaults] registerDefaults:@{
    @"WebAutomaticSpellingCorrectionEnabled" : @NO,
    @"WebAutomaticTextReplacementEnabled" : @NO,
    @"WebContinuousSpellCheckingEnabled" : @NO,
    @"WebAutomaticQuoteSubstitutionEnabled" : @NO,
    @"WebAutomaticDashSubstitutionEnabled" : @NO,
    @"WebGrammarCheckingEnabled" : @NO,
    @"WebAutomaticLinkDetectionEnabled" : @NO,
    @"NSAutoFillHeuristicControllerEnabled" : @NO
  }];
  logLine(
      "panel: WebKit autocorrect, spellcheck, autofill and text replacement defaults registered off (in memory only)");
}

WKWebViewConfiguration* makeConfiguration() {
  WKWebViewConfiguration* configuration = [[WKWebViewConfiguration alloc] init];
  configuration.websiteDataStore = [WKWebsiteDataStore nonPersistentDataStore];
  if ([configuration respondsToSelector:@selector(setAllowsInlinePredictions:)])
    [configuration setValue:@NO forKey:@"allowsInlinePredictions"];
  if (extynt::devLibraryBuild()) [configuration.preferences setValue:@YES forKey:@"developerExtrasEnabled"];
  return configuration;
}

extyntPanel* attachWebView(NSView* container, AEGP_PanelH panelH) {
  WKWebViewConfiguration* configuration = makeConfiguration();
  extyntWebView* web = [[extyntWebView alloc] initWithFrame:container.bounds configuration:configuration];
  [liveViews() addObject:web];
  web.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  if (@available(macOS 13.3, *)) web.inspectable = extynt::devLibraryBuild();
  extyntPanel* panel = [[extyntPanel alloc] init];
  panel.web = web;
  panel.userContent = configuration.userContentController;
  panel.delegate = [[extyntNavigationDelegate alloc] init];
  panel.delegate.panel = panel;
  panel.panelH = panelH;
  web.owner = panel;
  web.navigationDelegate = panel.delegate;
  panel.uiDelegate = [[extyntUIDelegate alloc] init];
  web.UIDelegate = panel.uiDelegate;
  [panel observeTheme];
  [panel startSessionWatch];
  [container addSubview:web];
  return panel;
}

void createPanel(AEGP_PlatformViewRef container, AEGP_PanelH panelH, AEGP_PanelFunctions1* table,
                 AEGP_PanelRefcon* outRefcon) {
  @try {
    const int count = ++g_createCount;
    logLine("panel: create #" + std::to_string(count) + " (container " + (container ? "present" : "NULL") + ")");
    table->GetSnapSizes = getSnapSizes;
    table->PopulateFlyout = populateFlyout;
    table->DoFlyoutCommand = doFlyoutCommand;
    if (!container) return;
    extyntPanel* panel = attachWebView(container, panelH);
    if (g_state.panel) g_state.panel->AEGP_SetTitle(panelH, extynt::ae::sdkText("extynt"));
    *outRefcon = extynt::ae::retainAsRefcon(panel);
    [panel loadPage];
  } @catch (NSException* exception) {
    logLine(std::string("panel: create failed: ") + [[exception reason] UTF8String]);
  }
}

A_Err createPanelHook(AEGP_GlobalRefcon, AEGP_CreatePanelRefcon, AEGP_PlatformViewRef container, AEGP_PanelH panelH,
                      AEGP_PanelFunctions1* table, AEGP_PanelRefcon* outRefcon) noexcept {
  try {
    createPanel(container, panelH, table, outRefcon);
  } catch (...) {
    logDroppedException("create panel");
  }
  return A_Err_NONE;
}

A_Err commandHook(AEGP_GlobalRefcon, AEGP_CommandRefcon, AEGP_Command command, AEGP_HookPriority, A_Boolean,
                  A_Boolean* handled) noexcept {
  if (command != g_state.menuCommand || !g_state.panel) return A_Err_NONE;
  const A_Err err = g_state.panel->AEGP_ToggleVisibility(kMatchName);
  try {
    logLine("panel: Window menu command -> ToggleVisibility, AEGP error " + std::to_string(err));
  } catch (...) {
    logDroppedException("menu command");
  }
  if (handled) *handled = TRUE;
  return A_Err_NONE;
}

A_Err updateMenuHook(AEGP_GlobalRefcon, AEGP_UpdateMenuRefcon, AEGP_WindowType) noexcept {
  if (!g_state.command || !g_state.panel) return A_Err_NONE;
  try {
    g_state.command->AEGP_EnableCommand(g_state.menuCommand);
    A_Boolean shown = FALSE, frontmost = FALSE;
    if (g_state.panel->AEGP_IsShown(kMatchName, &shown, &frontmost) == A_Err_NONE)
      g_state.command->AEGP_CheckMarkMenuCommand(g_state.menuCommand, shown && frontmost);
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
  A_Err err = g_state.command->AEGP_GetUniqueCommand(&g_state.menuCommand);
  if (!err)
    err = g_state.command->AEGP_InsertMenuCommand(g_state.menuCommand, kMenuName, AEGP_Menu_WINDOW,
                                                  AEGP_MENU_INSERT_SORTED);
  if (!err)
    err = registrar->AEGP_RegisterCommandHook(pluginId, AEGP_HP_BeforeAE, g_state.menuCommand, commandHook, nullptr);
  if (!err) err = registrar->AEGP_RegisterUpdateMenuHook(pluginId, updateMenuHook, nullptr);
  if (!err) err = g_state.panel->AEGP_RegisterCreatePanelHook(pluginId, kMatchName, createPanelHook, nullptr, TRUE);
  return err;
}

}

namespace extynt::ae::panel {

std::optional<HostTheme> currentHostTheme() {
  if (!g_state.app || !g_state.app->PF_AppGetBgColor) return std::nullopt;
  PF_App_Color color = {0, 0, 0};
  if (g_state.app->PF_AppGetBgColor(&color) != PF_Err_NONE) return std::nullopt;
  const HostTheme theme = hostThemeFromAppColor(color.red, color.green, color.blue);
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

}

namespace extynt::ae {

std::vector<SuiteStatus> registerNativePanel(const SPBasicSuite* basic, AEGP_PluginID pluginId,
                                             const AEGP_RegisterSuite5* registrar) {
  g_state = PanelState();
  g_state.basic = basic;
  if (!basic || !registrar) return {};
  try {
    g_state.statuses.push_back(acquire(*basic, "command", extynt::ae::suite::kCommand, g_state.command));
    g_state.statuses.push_back(acquire(*basic, "panel", extynt::ae::suite::kPanel, g_state.panel));
    g_state.statuses.push_back(acquire(*basic, "app", extynt::ae::suite::kApp, g_state.app));
    if (!g_state.command || !g_state.panel) {
      logLine("panel: suites missing, the native panel is not registered");
      return g_state.statuses;
    }
    registerQuietWebDefaults();
    const A_Err err = registerPanelHooks(pluginId, registrar);
    logLine(err ? "panel: registration failed, AEGP error " + std::to_string(err)
                : "panel: registered (Window > " + std::string(kMenuName) + ", match name extynt)");
    panel::installMonitor();
  } catch (...) {
    logLine("panel: registration threw");
  }
  return g_state.statuses;
}

void releaseNativePanel(const SPBasicSuite* basic) {
  panel::removeMonitor();
  if (!basic) return;
  for (const SuiteStatus& status : g_state.statuses) {
    if (status.acquired) basic->ReleaseSuite(status.sdkName.c_str(), status.acquired);
  }
  g_state = PanelState();
}

bool hostModalDialogOpen([[maybe_unused]] const AEGP_UtilitySuite4& utility) { return NSApp.modalWindow != nil; }

}

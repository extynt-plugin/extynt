// The native extynt panel: a dockable After Effects panel (AEGP Workspace Panel Suite) hosting a web view of the
// sidecar's UI, registered always and idle until the user opens Window > extynt. The page has no bridge to the plugin
// or the project; it reaches the sidecar over HTTP with a bearer token a user script hands it (window.__extyntNative).
// ae_panel_mac.mm hosts a WKWebView and ae_panel_win.cpp a WebView2 behind the same two functions.
#pragma once

#include <vector>

#include "ae_sdk.h"
#include "ae_suites.h"

namespace extynt::ae {

// Main thread, from the entry point once the register suite is available. Acquires the Panel and Command
// suites, inserts the Window menu command and registers its command hook, the update-menu hook and the
// create-panel hook with the match name "extynt", in the order the SDK's Panelator sample uses.
// Never throws. Returns the suite statuses (for the log and ping); an empty `acquired` means missing.
std::vector<SuiteStatus> registerNativePanel(const SPBasicSuite* basic, AEGP_PluginID pluginId,
                                             const AEGP_RegisterSuite5* registrar);

// Main thread, from the death hook: releases the suites registerNativePanel acquired.
void releaseNativePanel(const SPBasicSuite* basic);

}

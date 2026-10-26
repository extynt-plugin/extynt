// Objective-C++ only. The panel's Cocoa objects: the web view, its navigation delegate and the per-panel object that
// is handed to After Effects as the panel refcon. See ae_panel.h.
#pragma once

#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

#include <cstdint>
#include <optional>

#include "AE_GeneralPlugPanels.h"
#include "panel_theme.h"

@class extyntPanel;

@interface extyntWebView : WKWebView
@property(weak) extyntPanel* owner;
- (BOOL)firstResponderIsInside;
@end

@interface extyntNavigationDelegate : NSObject <WKNavigationDelegate>
@property(weak) extyntPanel* panel;
@end

@interface extyntUIDelegate : NSObject <WKUIDelegate>
@end

@interface extyntPanel : NSObject
@property(weak) extyntWebView* web;
@property(strong) extyntNavigationDelegate* delegate;
@property(strong) extyntUIDelegate* uiDelegate;
@property(strong) WKUserContentController* userContent;
@property AEGP_PanelH panelH;
@property(copy) NSString* scopeOrigin;
@property BOOL scopeAnyPath;
@property BOOL offline;
@property BOOL retryPending;
@property uint64_t loadTicket;
@property BOOL loadSettled;
@property BOOL sessionWatching;
@property(copy) NSString* shownTheme;
@property(strong) NSMutableArray* themeObservers;
// Reads session.json, then loads the sidecar UI (or a development override, or the offline page).
- (void)loadPage;
// Replaces the user scripts with fresh ones: the token and theme come from session.json and AE as they are now.
- (void)refreshUserScripts;
- (void)showOfflinePage;
// The latest load finished or failed: its watchdog stands down.
- (void)noteLoadSettled;
// Reloads the page when session.json names a different sidecar port than the page was loaded from (the sidecar
// restarted). Runs on the 3 s session watch and whenever the theme is checked.
- (void)reloadIfSidecarMoved;
// Starts the 3 s session watch (once). It checks only while the view is shown.
- (void)startSessionWatch;
// The view came back into a window: retry an offline page, and bring the theme up to date.
- (void)pageViewAppeared;
// Tells the page when AE's UI colour changed since it was last told ("extynt-theme").
- (void)pushTheme;
// AE announces no brightness change to a plugin, so the colour is re-read whenever a window becomes key or the app
// becomes active (which covers closing AE's Preferences).
- (void)observeTheme;
// Removes the theme observers (the web view is gone, so there is nothing left to tell).
- (void)stopObservingTheme;
@end

namespace extynt::ae::panel {

// The smallest size a panel window is allowed (points): the first snap size, and the floor for a floating window.
constexpr int kPanelMinimumWidth = 260;
constexpr int kPanelMinimumHeight = 320;

// AE's UI background (PF_AppGetBgColor) as a theme, nothing when the suite is missing or the call fails. Main thread.
std::optional<HostTheme> currentHostTheme();

}

// The panel's web view and its navigation and UI delegates. See ae_panel_view.h.
// Every method here is called by Cocoa or WebKit, so none may let a C++ exception out.
#import "ae_panel_view.h"

#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

#include <dispatch/dispatch.h>

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "ae_log.h"
#include "ae_panel_diag.h"
#include "ae_panel_guard.h"
#include "ae_platform.h"
#include "library_files.h"
#include "panel_nav.h"
#include "panel_menu.h"
#include "panel_page.h"

using extynt::ae::logLine;
using namespace extynt::ae::panel;

namespace {

void logKeyEquivalent(NSEvent* event) {
  if (g_logKeys.load() && event.type == NSEventTypeKeyDown) {
    logLine("panel key: view performKeyEquivalent reached the web view code=" + std::to_string(event.keyCode) +
            " mods=" + modifierText(event.modifierFlags));
  }
}

extynt::ae::MenuItemFacts factsOf(NSMenuItem* item) {
  extynt::ae::MenuItemFacts facts;
  facts.identifier = stdString(item.identifier);
  facts.title = stdString(item.title);
  facts.action = item.action ? stdString(NSStringFromSelector(item.action)) : std::string();
  facts.hasSubmenu = item.submenu != nil;
  return facts;
}

void removeMenuItems(NSMenu* menu, const std::vector<std::size_t>& indices) {
  for (auto at = indices.rbegin(); at != indices.rend(); ++at) [menu removeItemAtIndex:static_cast<NSInteger>(*at)];
}

std::string trimContextMenu(NSMenu* menu) {
  std::vector<std::size_t> dropped;
  std::string keptText, droppedText;
  for (NSInteger i = 0; i < menu.numberOfItems; ++i) {
    NSMenuItem* item = [menu itemAtIndex:i];
    if (item.separatorItem) continue;
    const extynt::ae::MenuItemFacts facts = factsOf(item);
    const bool keep = extynt::ae::keepContextMenuItem(facts, extynt::devLibraryBuild());
    (keep ? keptText : droppedText) += " [" + facts.title + " (" + facts.identifier + ")]";
    if (!keep) dropped.push_back(static_cast<std::size_t>(i));
  }
  removeMenuItems(menu, dropped);
  return "kept:" + (keptText.empty() ? std::string(" none") : keptText) +
         "; dropped:" + (droppedText.empty() ? std::string(" none") : droppedText);
}

void collapseSeparators(NSMenu* menu) {
  std::vector<bool> separator;
  for (NSInteger i = 0; i < menu.numberOfItems; ++i) separator.push_back([menu itemAtIndex:i].separatorItem);
  removeMenuItems(menu, extynt::ae::redundantSeparators(separator, std::vector<bool>(separator.size(), true)));
}

BOOL menuHasSelectAll(NSMenu* menu) {
  for (NSInteger i = 0; i < menu.numberOfItems; ++i) {
    const extynt::ae::MenuItemFacts facts = factsOf([menu itemAtIndex:i]);
    if (facts.action == "selectAll:" || facts.title == "Select All" ||
        facts.identifier.find("electAll") != std::string::npos)
      return YES;
  }
  return NO;
}

void trimAgainWhenTrackingBegins(NSMenu* menu) {
  __block id observer = nil;
  observer =
      [[NSNotificationCenter defaultCenter] addObserverForName:NSMenuDidBeginTrackingNotification
                                                        object:menu
                                                         queue:[NSOperationQueue mainQueue]
                                                    usingBlock:^(NSNotification*) {
                                                      [[NSNotificationCenter defaultCenter] removeObserver:observer];
                                                      observer = nil;
                                                      const std::string report = trimContextMenu(menu);
                                                      collapseSeparators(menu);
                                                      logLine("panel: context menu at tracking " + report);
                                                    }];
}

void limitFloatingWindow(NSWindow* window) {
  if (window == NSApp.mainWindow) return;
  const NSSize now = window.contentMinSize;
  const NSSize floor = {std::max(now.width, static_cast<CGFloat>(extynt::ae::panel::kPanelMinimumWidth)),
                        std::max(now.height, static_cast<CGFloat>(extynt::ae::panel::kPanelMinimumHeight))};
  window.contentMinSize = floor;
  logLine("panel: floating window minimum content size " + std::to_string(static_cast<int>(floor.width)) + "x" +
          std::to_string(static_cast<int>(floor.height)));
}

}

@implementation extyntWebView

- (void)willOpenMenu:(NSMenu*)menu withEvent:(NSEvent*)event {
  [super willOpenMenu:menu withEvent:event];
  guarded([self, menu] {
    const std::string report = trimContextMenu(menu);
    collapseSeparators(menu);
    if (!menuHasSelectAll(menu)) {
      if (menu.numberOfItems > 0) [menu addItem:[NSMenuItem separatorItem]];
      [menu addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@""].target = self;
    }
    logLine("panel: context menu " + report);
    trimAgainWhenTrackingBegins(menu);
  });
}

- (id)validRequestorForSendType:(NSPasteboardType)sendType returnType:(NSPasteboardType)returnType {
  return nil;
}

- (BOOL)acceptsFirstMouse:(NSEvent*)event {
  return YES;
}

- (BOOL)firstResponderIsInside {
  NSResponder* responder = self.window.firstResponder;
  if (responder == self) return YES;
  return [responder isKindOfClass:[NSView class]] && [static_cast<NSView*>(responder) isDescendantOf:self];
}

- (BOOL)performKeyEquivalent:(NSEvent*)event {
  guarded([event] { logKeyEquivalent(event); });
  return [super performKeyEquivalent:event];
}

- (void)viewDidMoveToWindow {
  [super viewDidMoveToWindow];
  guarded([self] {
    if (!self.window) {
      logLine("panel: web view removed from its window");
      return;
    }
    logLine("panel: web view moved into a window (" + windowText(self.window) + ")");
    limitFloatingWindow(self.window);
    [self.owner pageViewAppeared];
  });
}
- (void)viewDidHide {
  [super viewDidHide];
  guarded([] { logLine("panel: web view hidden"); });
}
- (void)viewDidUnhide {
  [super viewDidUnhide];
  guarded([self] {
    logLine("panel: web view shown");
    [self.owner pageViewAppeared];
  });
}
- (void)dealloc {
  guarded([] { logLine("panel: web view destroyed"); });
}

@end

namespace {

extynt::ae::NavigationScope scopeOf(extyntPanel* panel) {
  extynt::ae::NavigationScope scope;
  scope.origin = stdString(panel.scopeOrigin);
  scope.anyPath = panel.scopeAnyPath;
  return scope;
}

WKNavigationActionPolicy policyFor(extyntPanel* panel, WKNavigationAction* action) {
  NSURL* url = action.request.URL;
  extynt::ae::NavigationRequest request;
  request.url = url ? stdString(url.absoluteString) : std::string();
  request.linkActivated = action.navigationType == WKNavigationTypeLinkActivated;
  switch (extynt::ae::decideNavigation(scopeOf(panel), request)) {
    case extynt::ae::NavigationAction::Allow:
      if (action.targetFrame.mainFrame && request.url != "about:blank") [panel refreshUserScripts];
      return WKNavigationActionPolicyAllow;
    case extynt::ae::NavigationAction::OpenExternal:
      logLine("panel: a link to " + stdString(url.host) + " opens in the browser");
      [[NSWorkspace sharedWorkspace] openURL:url
                               configuration:[NSWorkspaceOpenConfiguration configuration]
                           completionHandler:nil];
      return WKNavigationActionPolicyCancel;
    case extynt::ae::NavigationAction::Cancel: break;
  }
  logLine("panel: navigation refused (" + std::string(request.linkActivated ? "link" : "script") + " to " +
          stdString(url.host) + ")");
  return WKNavigationActionPolicyCancel;
}

void handleNavigationFailure(extyntPanel* panel, NSError* error, const char* what) {
  const std::string domain = stdString(error.domain);
  const long code = static_cast<long>(error.code);
  [panel noteLoadSettled];
  logLine(std::string("panel: ") + what + " failed: " + stdString(error.localizedDescription) + " (" + domain + " " +
          std::to_string(code) + ")");
  if (extynt::ae::failureShowsOfflinePage(domain, code)) [panel showOfflinePage];
}

}

@implementation extyntNavigationDelegate
- (void)webView:(WKWebView*)webView
    decidePolicyForNavigationAction:(WKNavigationAction*)navigationAction
                    decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
  WKNavigationActionPolicy policy = WKNavigationActionPolicyCancel;
  guarded([&] { policy = policyFor(self.panel, navigationAction); });
  decisionHandler(policy);
}
- (void)webViewWebContentProcessDidTerminate:(WKWebView*)webView {
  guarded([self] {
    logLine("panel: web content process terminated (webViewWebContentProcessDidTerminate)");
    [self.panel showOfflinePage];
  });
}
- (void)webView:(WKWebView*)webView didFinishNavigation:(WKNavigation*)navigation {
  guarded([self, webView] {
    [self.panel noteLoadSettled];
    const std::string url = webView.URL ? stdString(webView.URL.absoluteString) : std::string();
    if (extynt::ae::finishedBlankShowsOfflinePage(url, self.panel.offline)) {
      logLine("panel: the page finished blank (WebKit refused the address without an error)");
      [self.panel showOfflinePage];
      return;
    }
    logLine("panel: page loaded");
  });
}
- (void)webView:(WKWebView*)webView didFailNavigation:(WKNavigation*)navigation withError:(NSError*)error {
  guarded([self, error] { handleNavigationFailure(self.panel, error, "navigation"); });
}
- (void)webView:(WKWebView*)webView didFailProvisionalNavigation:(WKNavigation*)navigation withError:(NSError*)error {
  guarded([self, error] { handleNavigationFailure(self.panel, error, "provisional navigation"); });
}
@end

@implementation extyntUIDelegate
- (void)webView:(WKWebView*)webView
    runJavaScriptAlertPanelWithMessage:(NSString*)message
                      initiatedByFrame:(WKFrameInfo*)frame
                     completionHandler:(void (^)(void))completionHandler {
  guarded([message] {
    logLine("panel: alert() answered at once, no dialog (" + std::to_string(message.length) + " chars)");
  });
  completionHandler();
}
- (void)webView:(WKWebView*)webView
    runJavaScriptConfirmPanelWithMessage:(NSString*)message
                        initiatedByFrame:(WKFrameInfo*)frame
                       completionHandler:(void (^)(BOOL))completionHandler {
  guarded([message] {
    logLine("panel: confirm() answered false at once, no dialog (" + std::to_string(message.length) + " chars)");
  });
  completionHandler(NO);
}
- (void)webView:(WKWebView*)webView
    runJavaScriptTextInputPanelWithPrompt:(NSString*)prompt
                              defaultText:(NSString*)defaultText
                         initiatedByFrame:(WKFrameInfo*)frame
                        completionHandler:(void (^)(NSString*))completionHandler {
  guarded([prompt] {
    logLine("panel: prompt() answered null at once, no dialog (" + std::to_string(prompt.length) + " chars)");
  });
  completionHandler(nil);
}
- (void)webView:(WKWebView*)webView
    runOpenPanelWithParameters:(WKOpenPanelParameters*)parameters
              initiatedByFrame:(WKFrameInfo*)frame
             completionHandler:(void (^)(NSArray<NSURL*>*))completionHandler {
  NSOpenPanel* open = [NSOpenPanel openPanel];
  open.allowsMultipleSelection = parameters.allowsMultipleSelection;
  open.allowedContentTypes = @[ UTTypePNG, UTTypeJPEG, UTTypeWebP ];
  auto finish = [completionHandler](NSModalResponse response, NSArray<NSURL*>* urls) {
    guarded([response, urls] {
      logLine("panel: file picker " + std::string(response == NSModalResponseOK ? "chose " : "cancelled, ") +
              std::to_string(response == NSModalResponseOK ? urls.count : 0) + " file(s)");
    });
    completionHandler(response == NSModalResponseOK ? urls : nil);
  };
  guarded([] { logLine("panel: file picker opened"); });
  [open beginWithCompletionHandler:^(NSModalResponse response) { finish(response, open.URLs); }];
  [open makeKeyAndOrderFront:nil];
}
@end

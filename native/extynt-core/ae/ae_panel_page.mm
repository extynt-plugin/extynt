// The per-panel object: loading the sidecar's page, the offline page and the development override, the injected user
// scripts, the session watch and the theme. See ae_panel_view.h.
// Every method here is called by Cocoa or WebKit, so none may let a C++ exception out.
#import "ae_panel_view.h"

#include <dispatch/dispatch.h>

#include <cstdint>
#include <optional>
#include <string>

#include "ae_log.h"
#include "ae_panel_diag.h"
#include "ae_panel_guard.h"
#include "ae_platform.h"
#include "library_files.h"
#include "panel_nav.h"
#include "panel_page.h"
#include "session_port.h"

#ifndef EXTYNT_PLUGIN_VERSION
#define EXTYNT_PLUGIN_VERSION "0.0.0-dev"
#endif

using extynt::ae::logLine;
using namespace extynt::ae::panel;

namespace {

const char* const kBaseUrl = "http://127.0.0.1/";
const char* const kBuiltinTestPage = "builtin:test";
const int64_t kRetryDelayNanoseconds = 2 * 1000000000LL;
const int64_t kSessionWatchDelayNanoseconds = 3 * 1000000000LL;

std::string trimmed(NSString* text) {
  NSString* clean = [text stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  return clean ? std::string([clean UTF8String]) : std::string();
}

std::optional<extynt::SessionEndpoint> readSession() {
  const std::string path = extynt::ae::stateDirectory() + "/session.json";
  NSString* content = [NSString stringWithContentsOfFile:[NSString stringWithUTF8String:path.c_str()]
                                                encoding:NSUTF8StringEncoding
                                                   error:nil];
  if (!content) return std::nullopt;
  return extynt::sessionEndpointFromJson(stdString(content));
}

std::string originOfSession(const extynt::SessionEndpoint& session) {
  return "http://127.0.0.1:" + std::to_string(session.port);
}

void addScript(WKUserContentController* controller, const std::string& source, WKUserScriptInjectionTime when,
               BOOL mainFrameOnly) {
  NSString* text = [NSString stringWithUTF8String:source.c_str()];
  if (!text) return;
  [controller addUserScript:[[WKUserScript alloc] initWithSource:text
                                                   injectionTime:when
                                                forMainFrameOnly:mainFrameOnly]];
}

std::string aeVersionText() {
  const std::string version = extynt::ae::hostVersionString();
  return version == "unknown" ? std::string() : version;
}

std::optional<extynt::ae::HostTheme> installUserScripts(WKUserContentController* controller,
                                                        const std::optional<extynt::SessionEndpoint>& session) {
  const std::optional<extynt::ae::HostTheme> theme = currentHostTheme();
  [controller removeAllUserScripts];
  if (session) {
    extynt::ae::NativeInfo info;
    info.pluginVersion = EXTYNT_PLUGIN_VERSION;
    info.aeVersion = aeVersionText();
    info.origin = originOfSession(*session);
    info.token = session->token;
    info.platform = "macos";
    info.theme = theme;
    addScript(controller, extynt::ae::panelNativeInfoScript(info), WKUserScriptInjectionTimeAtDocumentStart, YES);
  }
  addScript(controller, extynt::ae::panelDialogShimScript(), WKUserScriptInjectionTimeAtDocumentStart, NO);
  addScript(controller, extynt::ae::panelFieldHardeningScript(), WKUserScriptInjectionTimeAtDocumentEnd, NO);
  return theme;
}

NSString* nsString(const std::string& text) { return [NSString stringWithUTF8String:text.c_str()]; }

std::string developmentOverride() {
  if (!extynt::devLibraryBuild()) return std::string();
  const std::string path = extynt::ae::stateDirectory() + "/panel-url.txt";
  NSString* content = [NSString stringWithContentsOfFile:nsString(path) encoding:NSUTF8StringEncoding error:nil];
  return content ? trimmed(content) : std::string();
}

}

@implementation extyntPanel

- (void)loadPage {
  guarded([self] {
    extyntWebView* web = self.web;
    if (!web) return;
    self.offline = NO;
    self.loadSettled = YES;
    const std::string wanted = developmentOverride();
    if (wanted == kBuiltinTestPage) {
      [self loadBuiltinTestPageInto:web];
    } else if (wanted.empty() || ![self loadDevelopmentOverride:wanted into:web]) {
      [self loadSidecarUI:web];
    }
  });
}

- (void)refreshUserScripts {
  guarded([self] {
    const std::optional<extynt::ae::HostTheme> theme = installUserScripts(self.userContent, readSession());
    self.shownTheme = theme ? nsString(theme->background) : nil;
  });
}

- (void)loadSidecarUI:(extyntWebView*)web {
  const std::optional<extynt::SessionEndpoint> session = readSession();
  if (!session) {
    logLine("panel: no usable session.json, the sidecar is not running yet");
    [self showOfflinePage];
    return;
  }
  const std::string origin = originOfSession(*session);
  const std::optional<extynt::ae::HostTheme> theme = installUserScripts(self.userContent, session);
  self.shownTheme = theme ? nsString(theme->background) : nil;
  self.scopeOrigin = nsString(origin);
  self.scopeAnyPath = NO;
  logLine("panel: loading " + origin + "/ui/");
  [web loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:nsString(origin + "/ui/")]]];
  [self armLoadWatchdog];
}

- (void)armLoadWatchdog {
  const uint64_t ticket = ++self.loadTicket;
  self.loadSettled = NO;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, extynt::ae::kLoadWatchdogSeconds * 1000000000LL),
                 dispatch_get_main_queue(), ^{
                   guarded([self, ticket] {
                     if (!extynt::ae::loadWatchdogShowsOffline(ticket, self.loadTicket, self.loadSettled)) return;
                     logLine("panel: the page neither loaded nor failed in time");
                     [self showOfflinePage];
                   });
                 });
}

- (void)noteLoadSettled {
  self.loadSettled = YES;
}

- (BOOL)loadDevelopmentOverride:(const std::string&)wanted into:(extyntWebView*)web {
  NSURL* url = [NSURL URLWithString:nsString(wanted)];
  if (!url || !extynt::ae::developmentOverrideAllowed(extynt::devLibraryBuild(), wanted)) {
    logLine("panel: panel-url.txt is not an http(s) URL, loading the sidecar UI instead");
    return NO;
  }
  [self refreshUserScripts];
  self.scopeOrigin = nsString(extynt::ae::originOfUrl(wanted));
  self.scopeAnyPath = YES;
  logLine("panel: loading " + wanted + " (from panel-url.txt)");
  [web loadRequest:[NSURLRequest requestWithURL:url]];
  return YES;
}

- (void)loadBuiltinTestPageInto:(extyntWebView*)web {
  [self refreshUserScripts];
  self.scopeOrigin = nsString(extynt::ae::originOfUrl(kBaseUrl));
  self.scopeAnyPath = YES;
  logLine("panel: loading the built-in test page (panel-url.txt says builtin:test)");
  [web loadHTMLString:nsString(extynt::ae::panelTestPageHtml(g_createCount.load()))
              baseURL:[NSURL URLWithString:nsString(kBaseUrl)]];
}

- (void)showOfflinePage {
  guarded([self] {
    extyntWebView* web = self.web;
    if (!web) return;
    self.offline = YES;
    self.loadSettled = YES;
    self.scopeOrigin = @"";
    self.scopeAnyPath = NO;
    logLine("panel: showing the offline page, retrying in 2 s");
    [web loadHTMLString:nsString(extynt::ae::panelOfflinePageHtml()) baseURL:nil];
    [self scheduleRetry];
  });
}

- (void)scheduleRetry {
  if (self.retryPending) return;
  self.retryPending = YES;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, kRetryDelayNanoseconds), dispatch_get_main_queue(), ^{
    guarded([self] {
      self.retryPending = NO;
      if (!self.offline || !self.web.window || [self.web isHiddenOrHasHiddenAncestor]) return;
      logLine("panel: retrying the page");
      [self loadPage];
    });
  });
}

- (void)pageViewAppeared {
  guarded([self] {
    if (self.offline) {
      [self loadPage];
    } else {
      [self pushTheme];
    }
  });
}

- (void)pushTheme {
  guarded([self] {
    [self reloadIfSidecarMoved];
    extyntWebView* web = self.web;
    if (!web || self.offline || self.scopeOrigin.length == 0) return;
    const std::optional<extynt::ae::HostTheme> theme = currentHostTheme();
    if (!theme) return;
    NSString* background = nsString(theme->background);
    if ([background isEqualToString:self.shownTheme]) return;
    self.shownTheme = background;
    logLine("panel: AE's UI colour changed to " + theme->background + ", telling the page");
    [web evaluateJavaScript:nsString(extynt::ae::panelThemeEventScript(*theme)) completionHandler:nil];
  });
}

- (void)reloadIfSidecarMoved {
  guarded([self] {
    if (!self.web || self.offline || self.scopeAnyPath || self.scopeOrigin.length == 0) return;
    const std::optional<extynt::SessionEndpoint> session = readSession();
    if (!session || !extynt::ae::pageOriginIsStale(stdString(self.scopeOrigin), session->port)) return;
    logLine("panel: the sidecar moved to port " + std::to_string(session->port) + ", reloading the page");
    [self loadPage];
  });
}

- (void)startSessionWatch {
  if (self.sessionWatching) return;
  self.sessionWatching = YES;
  [self scheduleSessionCheck];
}

- (void)scheduleSessionCheck {
  __weak extyntPanel* weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, kSessionWatchDelayNanoseconds), dispatch_get_main_queue(), ^{
    extyntPanel* panel = weakSelf;
    if (!panel) return;
    extyntWebView* web = panel.web;
    if (!web) {
      panel.sessionWatching = NO;
      [panel stopObservingTheme];
      return;
    }
    if (web.window && ![web isHiddenOrHasHiddenAncestor]) [panel reloadIfSidecarMoved];
    [panel scheduleSessionCheck];
  });
}

- (void)observeTheme {
  if (self.themeObservers) return;
  __weak extyntPanel* weakSelf = self;
  void (^changed)(NSNotification*) = ^(NSNotification*) { [weakSelf pushTheme]; };
  NSNotificationCenter* center = [NSNotificationCenter defaultCenter];
  self.themeObservers = [NSMutableArray array];
  [self.themeObservers addObject:[center addObserverForName:NSWindowDidBecomeKeyNotification
                                                     object:nil
                                                      queue:[NSOperationQueue mainQueue]
                                                 usingBlock:changed]];
  [self.themeObservers addObject:[center addObserverForName:NSApplicationDidBecomeActiveNotification
                                                     object:nil
                                                      queue:[NSOperationQueue mainQueue]
                                                 usingBlock:changed]];
}

- (void)stopObservingTheme {
  for (id observer in self.themeObservers) [[NSNotificationCenter defaultCenter] removeObserver:observer];
  self.themeObservers = nil;
}

@end

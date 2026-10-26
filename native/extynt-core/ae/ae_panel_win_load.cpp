// Which page a Windows panel shows and when, and the scripts, retries, load watchdog and theme around it. The same
// behaviour as the macOS extyntPanel (ae_panel_view.mm); see ae_panel_win_panel.h.
#include <windows.h>

#include <fstream>
#include <iterator>
#include <optional>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "ae_log.h"
#include "ae_panel_win.h"
#include "ae_panel_win_panel.h"
#include "ae_platform.h"
#include "panel_nav.h"
#include "panel_page.h"
#include "path_text.h"
#include "session_port.h"
#include "windows_paths.h"

#ifndef EXTYNT_PLUGIN_VERSION
#define EXTYNT_PLUGIN_VERSION "0.0.0-dev"
#endif

namespace extynt::ae::panel {

namespace {

using ScriptAdded = ComCallback<ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler, HRESULT, LPCWSTR>;

const char* const kBaseUrl = "http://127.0.0.1/";
const char* const kBuiltinTestPage = "builtin:test";

std::string readTextFile(const std::string& path) {
  std::ifstream stream(extynt::pathFromUtf8(path), std::ios::binary);
  if (!stream) return {};
  return {std::istreambuf_iterator<char>(stream), std::istreambuf_iterator<char>()};
}

std::string trimmed(const std::string& text) {
  const char* const blanks = " \t\r\n";
  const std::size_t first = text.find_first_not_of(blanks);
  if (first == std::string::npos) return {};
  return text.substr(first, text.find_last_not_of(blanks) - first + 1);
}

std::optional<SessionEndpoint> readSession() {
  const std::string content = readTextFile(stateDirectory() + "/session.json");
  if (content.empty()) return std::nullopt;
  return sessionEndpointFromJson(content);
}

std::string originOfSession(const SessionEndpoint& session) {
  return "http://127.0.0.1:" + std::to_string(session.port);
}

std::string developmentOverride() { return trimmed(readTextFile(stateDirectory() + "/panel-url.txt")); }

std::string aeVersionText() {
  const std::string version = hostVersionString();
  return version == "unknown" ? std::string() : version;
}

std::wstring mainFrameOnly(const std::string& script) {
  return win::widen("if (window === window.top) {\n" + script + "\n}");
}

}

std::vector<std::wstring> WinPanel::userScripts(const std::optional<SessionEndpoint>& session) {
  const std::optional<HostTheme> theme = currentHostTheme();
  shownTheme_ = theme ? theme->background : std::string();
  std::vector<std::wstring> scripts;
  if (session) {
    NativeInfo info;
    info.pluginVersion = EXTYNT_PLUGIN_VERSION;
    info.aeVersion = aeVersionText();
    info.origin = originOfSession(*session);
    info.token = session->token;
    info.platform = "windows";
    info.theme = theme;
    scripts.push_back(mainFrameOnly(panelNativeInfoScript(info)));
  }
  scripts.push_back(win::widen(panelDialogShimScript()));
  scripts.push_back(win::widen(runAtDocumentEnd(panelFieldHardeningScript())));
  return scripts;
}

void WinPanel::refreshScripts(const std::function<void()>& then) {
  if (!view_) return;
  for (const std::wstring& id : scriptIds_) view_->RemoveScriptToExecuteOnDocumentCreated(id.c_str());
  scriptIds_.clear();
  session_ = readSession();
  const auto sources = std::make_shared<std::vector<std::wstring>>(userScripts(session_));
  installScripts(sources, 0, ++scriptGeneration_, then);
}

void WinPanel::installScripts(const std::shared_ptr<std::vector<std::wstring>>& sources, std::size_t index,
                              std::uint64_t generation, const std::function<void()>& then) {
  if (!alive_ || !view_ || generation != scriptGeneration_) return;
  if (index >= sources->size()) {
    then();
    return;
  }
  view_->AddScriptToExecuteOnDocumentCreated(
      (*sources)[index].c_str(),
      ScriptAdded::make([this, sources, index, generation, then](HRESULT status, LPCWSTR id) {
        if (SUCCEEDED(status) && id != nullptr) keepScript(generation, id);
        installScripts(sources, index + 1, generation, then);
        return S_OK;
      }).get());
}

void WinPanel::keepScript(std::uint64_t generation, LPCWSTR id) {
  if (generation == scriptGeneration_) {
    scriptIds_.emplace_back(id);
  } else if (view_) {
    view_->RemoveScriptToExecuteOnDocumentCreated(id);
  }
}

bool WinPanel::scriptsAreStale() const {
  const std::optional<SessionEndpoint> now = readSession();
  return now && session_ && now->token != session_->token;
}

void WinPanel::loadPage() {
  if (!view_) return;
  offline_ = false;
  loadSettled_ = true;
  const std::string wanted = developmentOverride();
  refreshScripts([this, wanted] { routeLoad(wanted); });
}

void WinPanel::routeLoad(const std::string& wanted) {
  if (wanted == kBuiltinTestPage) {
    loadBuiltinTestPage();
  } else if (wanted.empty() || !loadDevelopmentOverride(wanted)) {
    loadSidecarUi();
  }
}

void WinPanel::loadSidecarUi() {
  if (!session_) {
    logLine("panel: no usable session.json, the sidecar is not running yet");
    showOfflinePage();
    return;
  }
  const std::string origin = originOfSession(*session_);
  scopeOrigin_ = origin;
  scopeAnyPath_ = false;
  logLine("panel: loading " + origin + "/ui/");
  navigateTo(origin + "/ui/");
  armLoadWatchdog();
}

bool WinPanel::loadDevelopmentOverride(const std::string& wanted) {
  const std::string origin = originOfUrl(wanted);
  if (origin.empty()) {
    logLine("panel: panel-url.txt is not a URL, loading the sidecar UI instead");
    return false;
  }
  scopeOrigin_ = origin;
  scopeAnyPath_ = true;
  logLine("panel: loading " + wanted + " (from panel-url.txt)");
  navigateTo(wanted);
  return true;
}

void WinPanel::loadBuiltinTestPage() {
  scopeOrigin_ = originOfUrl(kBaseUrl);
  scopeAnyPath_ = true;
  logLine("panel: loading the built-in test page (panel-url.txt says builtin:test)");
  navigateToHtml(panelTestPageHtml(panelFlags().createCount.load()));
}

void WinPanel::showOfflinePage() {
  if (!view_) return;
  offline_ = true;
  loadSettled_ = true;
  scopeOrigin_.clear();
  scopeAnyPath_ = false;
  logLine("panel: showing the offline page, retrying in 2 s");
  navigateToHtml(panelOfflinePageHtml(currentHostTheme()));
  scheduleRetry();
}

void WinPanel::navigateTo(const std::string& url) {
  if (view_) view_->Navigate(win::widen(url).c_str());
}

void WinPanel::navigateToHtml(const std::string& html) {
  if (!view_) return;
  allowDataNavigation_ = true;
  stringPageShowing_ = true;
  view_->NavigateToString(win::widen(html).c_str());
}

void WinPanel::forgetStringPage(const std::string& uri) {
  if (uri.rfind("data:", 0) != 0 && uri != "about:blank") stringPageShowing_ = false;
}

NavigationAction WinPanel::navigationActionFor(const std::string& url, bool linkActivated) const {
  NavigationScope scope;
  scope.origin = scopeOrigin_;
  scope.anyPath = scopeAnyPath_;
  NavigationRequest request;
  request.url = url;
  request.linkActivated = linkActivated;
  return decideNavigation(scope, request);
}

void WinPanel::applyNavigation(ICoreWebView2NavigationStartingEventArgs* args, const std::string& uri,
                               bool linkActivated) {
  const NavigationAction action = navigationActionFor(uri, linkActivated);
  if (action == NavigationAction::Allow) {
    if (uri != "about:blank" && scriptsAreStale()) {
      args->put_Cancel(TRUE);
      refreshScripts([this, uri] { navigateTo(uri); });
    }
    return;
  }
  args->put_Cancel(TRUE);
  if (action == NavigationAction::OpenExternal) {
    openExternally(uri);
    return;
  }
  logLine(std::string("panel: navigation refused (") + (linkActivated ? "link" : "script") + " to " + originOfUrl(uri) +
          ")");
}

HRESULT WinPanel::onNavigationStarting(ICoreWebView2NavigationStartingEventArgs* args) {
  LPWSTR raw = nullptr;
  BOOL userInitiated = FALSE;
  args->get_Uri(&raw);
  args->get_IsUserInitiated(&userInitiated);
  const std::string uri = takeString(raw);
  if (allowDataNavigation_ && uri.rfind("data:", 0) == 0) return S_OK;
  forgetStringPage(uri);
  applyNavigation(args, uri, userInitiated != FALSE);
  return S_OK;
}

HRESULT WinPanel::onNavigationCompleted(ICoreWebView2NavigationCompletedEventArgs* args) {
  BOOL success = FALSE;
  COREWEBVIEW2_WEB_ERROR_STATUS status = COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;
  args->get_IsSuccess(&success);
  args->get_WebErrorStatus(&status);
  allowDataNavigation_ = false;
  if (success == FALSE) {
    if (status == COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED) return S_OK;
    noteLoadSettled();
    logLine("panel: navigation failed, web error status " + std::to_string(static_cast<int>(status)));
    if (webErrorShowsOfflinePage(static_cast<int>(status))) showOfflinePage();
    return S_OK;
  }
  noteLoadSettled();
  LPWSTR source = nullptr;
  view_->get_Source(&source);
  if (finishedBlankShowsOfflinePage(takeString(source), offline_ || stringPageShowing_)) {
    logLine("panel: the page finished blank (the address was refused without an error)");
    showOfflinePage();
    return S_OK;
  }
  logLine("panel: page loaded");
  return S_OK;
}

void WinPanel::armLoadWatchdog() {
  watchdogTicket_ = ++loadTicket_;
  loadSettled_ = false;
  SetTimer(host_, kTimerWatchdog, kLoadWatchdogSeconds * 1000, nullptr);
}

void WinPanel::scheduleRetry() {
  if (retryPending_) return;
  retryPending_ = true;
  SetTimer(host_, kTimerRetry, kRetryDelayMs, nullptr);
}

bool WinPanel::viewIsShown() const {
  return alive_ && view_ && shown_ && host_ != nullptr && IsWindowVisible(host_) != FALSE;
}

void WinPanel::onRecreateTimer() {
  KillTimer(host_, kTimerRecreate);
  if (alive_ && !view_) beginEnvironment();
}

void WinPanel::onWatchdogTimer() {
  KillTimer(host_, kTimerWatchdog);
  if (!loadWatchdogShowsOffline(watchdogTicket_, loadTicket_, loadSettled_)) return;
  logLine("panel: the page neither loaded nor failed in time");
  showOfflinePage();
}

void WinPanel::onRetryTimer() {
  KillTimer(host_, kTimerRetry);
  retryPending_ = false;
  if (!offline_ || !viewIsShown()) return;
  logLine("panel: retrying the page");
  loadPage();
}

void WinPanel::onTimer(UINT_PTR timerId) {
  if (timerId == kTimerRecreate) {
    onRecreateTimer();
  } else if (timerId == kTimerWatchdog) {
    onWatchdogTimer();
  } else if (timerId == kTimerRetry) {
    onRetryTimer();
  } else if (timerId == kTimerRefocus) {
    onRefocusTimer();
  } else if (timerId == kTimerSession && viewIsShown()) {
    pushTheme();
  }
}

void WinPanel::pageViewAppeared() {
  if (offline_) {
    loadPage();
  } else {
    pushTheme();
  }
}

void WinPanel::pushTheme() {
  reloadIfSidecarMoved();
  if (!view_ || offline_ || scopeOrigin_.empty()) return;
  const std::optional<HostTheme> theme = currentHostTheme();
  if (!theme || theme->background == shownTheme_) return;
  shownTheme_ = theme->background;
  logLine("panel: AE's UI colour changed to " + theme->background + ", telling the page");
  view_->ExecuteScript(win::widen(panelThemeEventScript(*theme)).c_str(), nullptr);
}

void WinPanel::reloadIfSidecarMoved() {
  if (!view_ || offline_ || scopeAnyPath_ || scopeOrigin_.empty()) return;
  const std::optional<SessionEndpoint> session = readSession();
  if (!session || !pageOriginIsStale(scopeOrigin_, session->port)) return;
  logLine("panel: the sidecar moved to port " + std::to_string(session->port) + ", reloading the page");
  loadPage();
}

}

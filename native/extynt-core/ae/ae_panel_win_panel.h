// Windows only. One native panel: a child "host" window inside the container window After Effects hands over, a
// WebView2 controller in the host, and the page-loading state machine (session.json, user scripts, offline page,
// retries, theme). The same contract as the macOS panel (docs/native/ui-contract.md). Main thread only; the object
// lives until the death hook (After Effects gives a panel no destroy callback), after its window is gone it only
// ignores calls.
#pragma once

#include <windows.h>
#include <objbase.h>

#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "AE_GeneralPlugPanels.h"
#include "WebView2.h"
#include "ae_panel_win_com.h"
#include "panel_nav.h"
#include "session_port.h"

namespace extynt::ae::panel {

// Timers of the host window (WM_TIMER on the main thread, so no nested event loop is ever run).
constexpr UINT_PTR kTimerRetry = 1;
constexpr UINT_PTR kTimerWatchdog = 2;
constexpr UINT_PTR kTimerSession = 3;
constexpr UINT_PTR kTimerRecreate = 4;
constexpr UINT_PTR kTimerRefocus = 5;
constexpr UINT kRetryDelayMs = 2000;
constexpr UINT kSessionWatchMs = 3000;
constexpr UINT kRecreateDelayMs = 2000;
constexpr UINT kRefocusDelayMs = 60;

class WinPanel {
 public:
  WinPanel(HWND container, AEGP_PanelH panelH);
  WinPanel(const WinPanel&) = delete;
  WinPanel& operator=(const WinPanel&) = delete;
  WinPanel(WinPanel&&) = delete;
  WinPanel& operator=(WinPanel&&) = delete;
  ~WinPanel();

  // Creates the host window inside the container and starts the WebView2 environment. False when the window failed.
  bool open();
  // Called by the window procedures.
  LRESULT hostMessage(UINT message, WPARAM wParam, LPARAM lParam);
  void containerMessage(UINT message, WPARAM wParam);
  [[nodiscard]] HWND host() const { return host_; }
  bool contains(HWND window) const;
  [[nodiscard]] bool alive() const { return alive_; }
  // Closes the web view and forgets the windows (the container is going away, or the plugin is unloading).
  void close();

  void resizeToHost();
  void setShown(bool shown);
  // Sends a key event to the page as the Chrome DevTools Protocol would (the key hook uses this).
  void dispatchKey(const std::string& parametersJson);
  // The flyout's "Reload page".
  void reloadFromFlyout();

  void loadPage();
  void onTimer(UINT_PTR timerId);
  void pageViewAppeared();
  // The system brought `foreground` to the front; the web view gets the keyboard back if this panel's window returns.
  void foregroundChanged(HWND foreground);
  // The web view took or lost the keyboard focus.
  void noteFocus(bool gained);

 private:
  LRESULT hostFocusMessage(UINT message, WPARAM wParam, LPARAM lParam);
  void beginEnvironment();
  void onEnvironment(HRESULT status, ICoreWebView2Environment* environment);
  HRESULT createPrivateController(const ComRef<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>& done);
  void onController(HRESULT status, ICoreWebView2Controller* controller);
  void configureView();
  void registerHandlers();
  void registerNavigationHandlers();
  static void registerPolicyHandlers(const ComRef<ICoreWebView2>& view);
  void fail(const std::string& what);
  void recreateAfterBrowserExit();
  static void trimContextMenu(ICoreWebView2ContextMenuRequestedEventArgs* args);
  void onAcceleratorKey(ICoreWebView2AcceleratorKeyPressedEventArgs* args);
  bool forceKeyToPage(unsigned virtualKey, bool down);
  HRESULT onProcessFailed(ICoreWebView2ProcessFailedEventArgs* args);
  HRESULT onNewWindow(ICoreWebView2NewWindowRequestedEventArgs* args);

  void routeLoad(const std::string& wanted);
  void loadSidecarUi();
  [[nodiscard]] bool scriptsAreStale() const;
  bool loadDevelopmentOverride(const std::string& wanted);
  void loadBuiltinTestPage();
  void showOfflinePage();
  void navigateTo(const std::string& url);
  void navigateToHtml(const std::string& html);
  void forgetStringPage(const std::string& uri);
  void refreshScripts(const std::function<void()>& then);
  void installScripts(const std::shared_ptr<std::vector<std::wstring>>& sources, std::size_t index,
                      std::uint64_t generation, const std::function<void()>& then);
  std::vector<std::wstring> userScripts(const std::optional<SessionEndpoint>& session);
  [[nodiscard]] NavigationAction navigationActionFor(const std::string& url, bool linkActivated) const;
  void applyNavigation(ICoreWebView2NavigationStartingEventArgs* args, const std::string& uri, bool linkActivated);
  void keepScript(std::uint64_t generation, LPCWSTR id);
  HRESULT onNavigationStarting(ICoreWebView2NavigationStartingEventArgs* args);
  HRESULT onNavigationCompleted(ICoreWebView2NavigationCompletedEventArgs* args);
  void armLoadWatchdog();
  void scheduleRetry();
  void noteLoadSettled() { loadSettled_ = true; }
  void pushTheme();
  void reloadIfSidecarMoved();
  [[nodiscard]] bool viewIsShown() const;
  void focusPage();
  void onRefocusTimer();
  void trackFrame();
  void releaseFrame();
  bool usesFrame(HWND frame) const { return alive_ && frame_ == frame; }
  void onRecreateTimer();
  void onWatchdogTimer();
  void onRetryTimer();

  HWND container_;
  HWND host_ = nullptr;
  HWND frame_ = nullptr;
  AEGP_PanelH panelH_;
  bool alive_ = true;
  bool shown_ = true;
  bool pageHasFocus_ = false;
  bool refocusOnReturn_ = false;
  ComRef<ICoreWebView2Environment> environment_;
  ComRef<ICoreWebView2Controller> controller_;
  ComRef<ICoreWebView2> view_;
  std::wstring failure_;

  std::string scopeOrigin_;
  bool scopeAnyPath_ = false;
  bool offline_ = false;
  bool retryPending_ = false;
  bool allowDataNavigation_ = false;
  bool stringPageShowing_ = false;
  bool pageRequested_ = false;
  std::uint64_t loadTicket_ = 0;
  bool loadSettled_ = true;
  std::string shownTheme_;
  std::optional<SessionEndpoint> session_;
  std::uint64_t watchdogTicket_ = 0;
  std::uint64_t scriptGeneration_ = 0;
  std::vector<std::wstring> scriptIds_;
};

// Every panel created in this AE session (they are not destroyed before the death hook).
std::vector<std::unique_ptr<WinPanel>>& livePanels();

// Opens `uri` in the default browser.
void openExternally(const std::string& uri);

// Removes the host window class (the plugin is unloading); every panel is closed first.
void unregisterHostClass();

// The panel whose host window contains `window`, null when `window` is none of ours.
WinPanel* panelContaining(HWND window);

}

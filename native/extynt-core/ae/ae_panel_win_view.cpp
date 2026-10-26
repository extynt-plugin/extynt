// The WebView2 controller of one panel: environment and controller creation, settings, event handlers, key and menu
// hooks. See ae_panel_win_panel.h.
#include <windows.h>
#include <shellapi.h>

#include <filesystem>
#include <string>
#include <system_error>
#include <vector>

#include "ae_log.h"
#include "ae_panel_win.h"
#include "ae_panel_win_keys.h"
#include "ae_panel_win_options.h"
#include "ae_panel_win_panel.h"
#include "library_files.h"
#include "panel_nav.h"
#include "panel_page.h"
#include "path_text.h"
#include "windows_paths.h"

namespace extynt::ae::panel {

namespace {

using EnvironmentDone =
    ComCallback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler, HRESULT, ICoreWebView2Environment*>;
using ControllerDone =
    ComCallback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler, HRESULT, ICoreWebView2Controller*>;
using NavigationStartingHandler =
    ComCallback<ICoreWebView2NavigationStartingEventHandler, ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs*>;
using NavigationCompletedHandler = ComCallback<ICoreWebView2NavigationCompletedEventHandler, ICoreWebView2*,
                                               ICoreWebView2NavigationCompletedEventArgs*>;
using NewWindowHandler =
    ComCallback<ICoreWebView2NewWindowRequestedEventHandler, ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs*>;
using ContextMenuHandler = ComCallback<ICoreWebView2ContextMenuRequestedEventHandler, ICoreWebView2*,
                                       ICoreWebView2ContextMenuRequestedEventArgs*>;
using ProcessFailedHandler =
    ComCallback<ICoreWebView2ProcessFailedEventHandler, ICoreWebView2*, ICoreWebView2ProcessFailedEventArgs*>;
using DialogHandler = ComCallback<ICoreWebView2ScriptDialogOpeningEventHandler, ICoreWebView2*,
                                  ICoreWebView2ScriptDialogOpeningEventArgs*>;
using PermissionHandler = ComCallback<ICoreWebView2PermissionRequestedEventHandler, ICoreWebView2*,
                                      ICoreWebView2PermissionRequestedEventArgs*>;
using DownloadHandler =
    ComCallback<ICoreWebView2DownloadStartingEventHandler, ICoreWebView2*, ICoreWebView2DownloadStartingEventArgs*>;
using AcceleratorHandler = ComCallback<ICoreWebView2AcceleratorKeyPressedEventHandler, ICoreWebView2Controller*,
                                       ICoreWebView2AcceleratorKeyPressedEventArgs*>;
using FocusHandler = ComCallback<ICoreWebView2FocusChangedEventHandler, ICoreWebView2Controller*, IUnknown*>;

const wchar_t* const kBrowserArguments = L"--disable-spell-checking --disable-features=Translate,msEdgeSpellcheck";
const HRESULT kRuntimeMissing = kFileNotFoundResult;

std::wstring userDataFolder() {
  const std::string folder = extynt::ae::stateDirectory() + "/WebView2";
  std::error_code ignored;
  std::filesystem::create_directories(extynt::pathFromUtf8(folder), ignored);
  return win::widen(folder);
}

COREWEBVIEW2_COLOR colourOf(const std::string& hex) {
  COREWEBVIEW2_COLOR colour{255, 0, 0, 0};
  if (hex.size() != 7 || hex[0] != '#') return colour;
  const auto channel = [&hex](std::size_t at) { return static_cast<BYTE>(std::stoi(hex.substr(at, 2), nullptr, 16)); };
  colour.R = channel(1);
  colour.G = channel(3);
  colour.B = channel(5);
  return colour;
}

void setSettings(ICoreWebView2Settings* settings) {
  settings->put_IsScriptEnabled(TRUE);
  settings->put_IsWebMessageEnabled(FALSE);
  settings->put_AreHostObjectsAllowed(FALSE);
  settings->put_AreDefaultScriptDialogsEnabled(FALSE);
  settings->put_IsStatusBarEnabled(FALSE);
  settings->put_IsZoomControlEnabled(FALSE);
  settings->put_IsBuiltInErrorPageEnabled(FALSE);
  settings->put_AreDefaultContextMenusEnabled(TRUE);
  settings->put_AreDevToolsEnabled(devLibraryBuild() ? TRUE : FALSE);
}

void setNewerSettings(const ComRef<ICoreWebView2Settings>& settings) {
  if (const ComRef<ICoreWebView2Settings3> third = settings.as<ICoreWebView2Settings3>()) {
    third->put_AreBrowserAcceleratorKeysEnabled(FALSE);
  }
  if (const ComRef<ICoreWebView2Settings4> fourth = settings.as<ICoreWebView2Settings4>()) {
    fourth->put_IsPasswordAutosaveEnabled(FALSE);
    fourth->put_IsGeneralAutofillEnabled(FALSE);
  }
  if (const ComRef<ICoreWebView2Settings5> fifth = settings.as<ICoreWebView2Settings5>()) {
    fifth->put_IsPinchZoomEnabled(FALSE);
  }
  if (const ComRef<ICoreWebView2Settings6> sixth = settings.as<ICoreWebView2Settings6>()) {
    sixth->put_IsSwipeNavigationEnabled(FALSE);
  }
}

}

void openExternally(const std::string& uri) {
  logLine("panel: a link to " + originOfUrl(uri) + " opens in the browser");
  ShellExecuteW(nullptr, L"open", win::widen(uri).c_str(), nullptr, nullptr, SW_SHOWNORMAL);
}

void WinPanel::fail(const std::string& what) {
  logLine("panel: " + what);
  failure_ = win::widen(what);
  if (host_ != nullptr) InvalidateRect(host_, nullptr, TRUE);
}

void WinPanel::beginEnvironment() {
  const HRESULT apartment = startComOnce();
  if (FAILED(apartment) && apartment != kApartmentChanged) {
    fail("COM could not start on the main thread (HRESULT " + std::to_string(static_cast<long>(apartment)) + ")");
    return;
  }
  if (apartment == kApartmentChanged)
    logLine("panel: the main thread is not a single-threaded apartment; WebView2 may refuse");
  const ComRef<ICoreWebView2EnvironmentOptions> options = makeEnvironmentOptions(kBrowserArguments);
  const ComRef<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler> done =
      EnvironmentDone::make([this](HRESULT status, ICoreWebView2Environment* environment) {
        onEnvironment(status, environment);
        return S_OK;
      });
  const HRESULT started =
      CreateCoreWebView2EnvironmentWithOptions(nullptr, userDataFolder().c_str(), options.get(), done.get());
  if (FAILED(started)) onEnvironment(started, nullptr);
}

void WinPanel::onEnvironment(HRESULT status, ICoreWebView2Environment* environment) {
  if (!alive_) return;
  if (FAILED(status) || environment == nullptr) {
    fail(
        status == kRuntimeMissing
            ? "The WebView2 Runtime is not installed. Install it from https://go.microsoft.com/fwlink/p/?LinkId=2124703"
            : "WebView2 could not start (HRESULT " + std::to_string(static_cast<long>(status)) + ")");
    return;
  }
  environment_ = ComRef<ICoreWebView2Environment>(environment);
  const ComRef<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler> done =
      ControllerDone::make([this](HRESULT result, ICoreWebView2Controller* controller) {
        onController(result, controller);
        return S_OK;
      });
  HRESULT started = createPrivateController(done);
  if (FAILED(started)) started = environment_->CreateCoreWebView2Controller(host_, done.get());
  if (FAILED(started)) onController(started, nullptr);
}

HRESULT WinPanel::createPrivateController(
    const ComRef<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>& done) {
  const ComRef<ICoreWebView2Environment10> newer = environment_.as<ICoreWebView2Environment10>();
  if (!newer) return E_NOINTERFACE;
  ComRef<ICoreWebView2ControllerOptions> options;
  newer->CreateCoreWebView2ControllerOptions(options.put());
  if (!options) return E_NOINTERFACE;
  options->put_IsInPrivateModeEnabled(TRUE);
  const HRESULT started = newer->CreateCoreWebView2ControllerWithOptions(host_, options.get(), done.get());
  logLine("panel: creating the web view in private mode");
  return started;
}

void WinPanel::onController(HRESULT status, ICoreWebView2Controller* controller) {
  if (!alive_) return;
  if (FAILED(status) || controller == nullptr) {
    fail("The web view could not be created (HRESULT " + std::to_string(static_cast<long>(status)) + ")");
    return;
  }
  controller_ = ComRef<ICoreWebView2Controller>(controller);
  controller_->get_CoreWebView2(view_.put());
  if (!view_) {
    fail("The web view has no core");
    return;
  }
  configureView();
  registerHandlers();
  resizeToHost();
  controller_->put_IsVisible(shown_ ? TRUE : FALSE);
  logLine("panel: web view created");
  refreshScripts([this] { loadPage(); });
}

void WinPanel::configureView() {
  ComRef<ICoreWebView2Settings> settings;
  view_->get_Settings(settings.put());
  if (settings) {
    setSettings(settings.get());
    setNewerSettings(settings);
  }
  const std::optional<HostTheme> theme = currentHostTheme();
  if (const ComRef<ICoreWebView2Controller2> second = controller_.as<ICoreWebView2Controller2>()) {
    if (theme) second->put_DefaultBackgroundColor(colourOf(theme->background));
  }
}

void WinPanel::registerHandlers() {
  registerNavigationHandlers();
  registerPolicyHandlers(view_);
  EventRegistrationToken token{};
  controller_->add_AcceleratorKeyPressed(
      AcceleratorHandler::make([this](ICoreWebView2Controller*, ICoreWebView2AcceleratorKeyPressedEventArgs* args) {
        onAcceleratorKey(args);
        return S_OK;
      }).get(),
      &token);
  controller_->add_GotFocus(FocusHandler::make([this](ICoreWebView2Controller*, IUnknown*) {
                              noteFocus(true);
                              if (panelFlags().logKeys.load())
                                logLine("panel key: the web view took the keyboard focus");
                              return S_OK;
                            }).get(),
                            &token);
  controller_->add_LostFocus(FocusHandler::make([this](ICoreWebView2Controller*, IUnknown*) {
                               noteFocus(false);
                               return S_OK;
                             }).get(),
                             &token);
  if (const ComRef<ICoreWebView2_11> eleventh = view_.as<ICoreWebView2_11>()) {
    eleventh->add_ContextMenuRequested(
        ContextMenuHandler::make([this](ICoreWebView2*, ICoreWebView2ContextMenuRequestedEventArgs* args) {
          trimContextMenu(args);
          return S_OK;
        }).get(),
        &token);
  }
}

void WinPanel::registerNavigationHandlers() {
  EventRegistrationToken token{};
  view_->add_NavigationStarting(
      NavigationStartingHandler::make([this](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) {
        return onNavigationStarting(args);
      }).get(),
      &token);
  view_->add_NavigationCompleted(
      NavigationCompletedHandler::make([this](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args) {
        return onNavigationCompleted(args);
      }).get(),
      &token);
  view_->add_NewWindowRequested(
      NewWindowHandler::make([this](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) {
        return onNewWindow(args);
      }).get(),
      &token);
  view_->add_ProcessFailed(
      ProcessFailedHandler::make([this](ICoreWebView2*, ICoreWebView2ProcessFailedEventArgs* args) {
        return onProcessFailed(args);
      }).get(),
      &token);
}

void WinPanel::registerPolicyHandlers(const ComRef<ICoreWebView2>& view) {
  EventRegistrationToken token{};
  view->add_ScriptDialogOpening(DialogHandler::make([](ICoreWebView2*, ICoreWebView2ScriptDialogOpeningEventArgs*) {
                                  logLine("panel: a script dialog was dismissed at once, no dialog");
                                  return S_OK;
                                }).get(),
                                &token);
  view->add_PermissionRequested(
      PermissionHandler::make([](ICoreWebView2*, ICoreWebView2PermissionRequestedEventArgs* args) {
        args->put_State(COREWEBVIEW2_PERMISSION_STATE_DENY);
        return S_OK;
      }).get(),
      &token);
  if (const ComRef<ICoreWebView2_4> fourth = view.as<ICoreWebView2_4>()) {
    fourth->add_DownloadStarting(
        DownloadHandler::make([](ICoreWebView2*, ICoreWebView2DownloadStartingEventArgs* args) {
          args->put_Cancel(TRUE);
          args->put_Handled(TRUE);
          return S_OK;
        }).get(),
        &token);
  }
}

void WinPanel::onAcceleratorKey(ICoreWebView2AcceleratorKeyPressedEventArgs* args) {
  COREWEBVIEW2_KEY_EVENT_KIND kind = COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN;
  UINT virtualKey = 0;
  args->get_KeyEventKind(&kind);
  args->get_VirtualKey(&virtualKey);
  const bool down = kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN || kind == COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN;
  logAcceleratorKey(virtualKey, down);
  if (panelFlags().keyForce.load() && forceKeyToPage(virtualKey, down)) args->put_Handled(TRUE);
}

bool WinPanel::forceKeyToPage(unsigned virtualKey, bool down) {
  const WinKeyEvent event = currentKeyEvent(virtualKey);
  if (classifyWindowsKey(event).route != WinKeyRoute::PageForced) return false;
  const std::optional<std::string> parameters = cdpKeyEventParameters(event, !down);
  if (!parameters) return false;
  dispatchKey(*parameters);
  return true;
}

HRESULT WinPanel::onNewWindow(ICoreWebView2NewWindowRequestedEventArgs* args) {
  args->put_Handled(TRUE);
  LPWSTR uri = nullptr;
  BOOL userInitiated = FALSE;
  args->get_Uri(&uri);
  args->get_IsUserInitiated(&userInitiated);
  const std::string target = takeString(uri);
  if (navigationActionFor(target, userInitiated != FALSE) == NavigationAction::OpenExternal) openExternally(target);
  return S_OK;
}

HRESULT WinPanel::onProcessFailed(ICoreWebView2ProcessFailedEventArgs* args) {
  COREWEBVIEW2_PROCESS_FAILED_KIND kind = COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED;
  args->get_ProcessFailedKind(&kind);
  logLine("panel: web view process failed, kind " + std::to_string(static_cast<int>(kind)));
  if (kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED) {
    recreateAfterBrowserExit();
  } else if (kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED ||
             kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE) {
    showOfflinePage();
  }
  return S_OK;
}

void WinPanel::recreateAfterBrowserExit() {
  controller_.reset();
  view_.reset();
  environment_.reset();
  scriptIds_.clear();
  SetTimer(host_, kTimerRecreate, kRecreateDelayMs, nullptr);
}

void WinPanel::resizeToHost() {
  if (!controller_ || host_ == nullptr) return;
  RECT bounds{};
  GetClientRect(host_, &bounds);
  controller_->put_Bounds(bounds);
}

void WinPanel::setShown(bool shown) {
  shown_ = shown;
  if (controller_) controller_->put_IsVisible(shown ? TRUE : FALSE);
  if (shown) pageViewAppeared();
}

void WinPanel::dispatchKey(const std::string& parametersJson) {
  if (!view_) return;
  view_->CallDevToolsProtocolMethod(L"Input.dispatchKeyEvent", win::widen(parametersJson).c_str(), nullptr);
}

void WinPanel::reloadFromFlyout() {
  logLine("panel: reload requested from the flyout");
  if (!view_) {
    SetTimer(host_, kTimerRecreate, 0, nullptr);
    return;
  }
  loadPage();
}

}

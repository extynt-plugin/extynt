// The windows of a panel: the host window in the container After Effects hands over, the subclass that follows the
// container, and the minimum size of a floating panel window. Window procedures never let a C++ exception out.
#include <windows.h>

#include <algorithm>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "ae_log.h"
#include "ae_panel_win.h"
#include "ae_panel_win_keys.h"
#include "ae_panel_win_panel.h"
#include "sdk_win_module.h"
#include "sdk_win_window.h"
#include "windows_paths.h"

namespace extynt::ae::panel {

namespace {

const wchar_t* const kHostClass = L"extyntPanelHost";

COLORREF backgroundColour() {
  const std::optional<HostTheme> theme = currentHostTheme();
  if (!theme || theme->background.size() != 7) return GetSysColor(COLOR_WINDOW);
  const auto channel = [&theme](std::size_t at) { return std::stoi(theme->background.substr(at, 2), nullptr, 16); };
  return RGB(channel(1), channel(3), channel(5));
}

void paintHost(HWND host, const std::wstring& failure) {
  PAINTSTRUCT paint{};
  HDC context = BeginPaint(host, &paint);
  RECT area{};
  GetClientRect(host, &area);
  HBRUSH brush = CreateSolidBrush(backgroundColour());
  FillRect(context, &area, brush);
  DeleteObject(brush);
  if (!failure.empty()) {
    InflateRect(&area, -12, -12);
    SetBkMode(context, TRANSPARENT);
    SetTextColor(context, RGB(200, 200, 200));
    DrawTextW(context, failure.c_str(), static_cast<int>(failure.size()), &area, DT_WORDBREAK | DT_NOPREFIX);
  }
  EndPaint(host, &paint);
}

LRESULT CALLBACK hostProc(HWND host, UINT message, WPARAM wParam, LPARAM lParam) noexcept {
  try {
    WinPanel* panel = sdkwin::hostPanel(host);
    if (panel != nullptr) return panel->hostMessage(message, wParam, lParam);
  } catch (...) {
    logDroppedException("panel host window");
  }
  return DefWindowProcW(host, message, wParam, lParam);
}

bool notifiesBefore(UINT message) { return message == WM_DESTROY; }

bool notifiesAfter(UINT message) { return message == WM_SIZE || message == WM_SHOWWINDOW; }

LRESULT CALLBACK containerProc(HWND container, UINT message, WPARAM wParam, LPARAM lParam) noexcept {
  WNDPROC original = sdkwin::subclassedOriginal(container);
  if (original == nullptr) return DefWindowProcW(container, message, wParam, lParam);
  try {
    WinPanel* panel = sdkwin::containerPanel(container);
    if (panel != nullptr && notifiesBefore(message)) panel->containerMessage(message, wParam);
    if (message == WM_NCDESTROY) sdkwin::releaseSubclass(container, containerProc);
    const LRESULT result = CallWindowProcW(original, container, message, wParam, lParam);
    if (panel != nullptr && notifiesAfter(message)) panel->containerMessage(message, wParam);
    return result;
  } catch (...) {
    logDroppedException("panel container window");
  }
  return CallWindowProcW(original, container, message, wParam, lParam);
}

void raiseMinimumTrackSize(HWND frame, LPARAM lParam) {
  RECT outer{};
  RECT inner{};
  GetWindowRect(frame, &outer);
  GetClientRect(frame, &inner);
  MINMAXINFO* info = sdkwin::minMaxInfo(lParam);
  const LONG extraWidth = (outer.right - outer.left) - (inner.right - inner.left);
  const LONG extraHeight = (outer.bottom - outer.top) - (inner.bottom - inner.top);
  info->ptMinTrackSize.x = std::max(info->ptMinTrackSize.x, kPanelMinimumWidth + extraWidth);
  info->ptMinTrackSize.y = std::max(info->ptMinTrackSize.y, kPanelMinimumHeight + extraHeight);
}

LRESULT CALLBACK frameProc(HWND frame, UINT message, WPARAM wParam, LPARAM lParam) noexcept {
  WNDPROC original = sdkwin::subclassedOriginal(frame);
  if (original == nullptr) return DefWindowProcW(frame, message, wParam, lParam);
  if (message == WM_NCDESTROY) sdkwin::releaseSubclass(frame, frameProc);
  const LRESULT result = CallWindowProcW(original, frame, message, wParam, lParam);
  if (message == WM_GETMINMAXINFO && lParam != 0) raiseMinimumTrackSize(frame, lParam);
  return result;
}

HWND floatingFrameOf(HWND container) {
  HWND frame = GetAncestor(container, GA_ROOT);
  if (frame == nullptr || frame == container || isMainFrameWindow(frame)) return nullptr;
  return frame;
}

HMODULE moduleOfThisCode() { return sdkwin::moduleContaining(&hostProc); }

bool registerHostClass() {
  WNDCLASSEXW window{};
  window.cbSize = sizeof window;
  window.lpfnWndProc = hostProc;
  window.hInstance = moduleOfThisCode();
  window.hCursor = LoadCursorW(nullptr, MAKEINTRESOURCEW(32512));
  window.lpszClassName = kHostClass;
  return RegisterClassExW(&window) != 0 || GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
}

}

std::vector<std::unique_ptr<WinPanel>>& livePanels() {
  static std::vector<std::unique_ptr<WinPanel>> panels;
  return panels;
}

WinPanel* panelContaining(HWND window) {
  if (window == nullptr) return nullptr;
  for (const std::unique_ptr<WinPanel>& panel : livePanels()) {
    if (panel->alive() && panel->contains(window)) return panel.get();
  }
  return nullptr;
}

WinPanel::WinPanel(HWND container, AEGP_PanelH panelH) : container_(container), panelH_(panelH) {}

WinPanel::~WinPanel() { close(); }

bool WinPanel::contains(HWND window) const {
  return host_ != nullptr && (window == host_ || IsChild(host_, window) != FALSE);
}

bool WinPanel::open() {
  if (!registerHostClass()) {
    logLine("panel: the host window class could not be registered, error " + std::to_string(GetLastError()));
    return false;
  }
  RECT area{};
  GetClientRect(container_, &area);
  host_ =
      CreateWindowExW(0, kHostClass, L"extynt", WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS, 0, 0,
                      area.right - area.left, area.bottom - area.top, container_, nullptr, moduleOfThisCode(), nullptr);
  if (host_ == nullptr) {
    logLine("panel: the host window could not be created, error " + std::to_string(GetLastError()));
    return false;
  }
  sdkwin::bindHostPanel(host_, *this);
  sdkwin::bindContainerPanel(container_, *this);
  sdkwin::subclassWindow(container_, containerProc);
  trackFrame();
  SetTimer(host_, kTimerSession, kSessionWatchMs, nullptr);
  shown_ = IsWindowVisible(container_) != FALSE;
  beginEnvironment();
  return true;
}

LRESULT WinPanel::hostMessage(UINT message, WPARAM wParam, LPARAM lParam) {
  switch (message) {
    case WM_SIZE: resizeToHost(); return 0;
    case WM_TIMER: onTimer(wParam); return 0;
    case WM_ERASEBKGND: return controller_ ? 1 : DefWindowProcW(host_, message, wParam, lParam);
    case WM_PAINT: paintHost(host_, failure_); return 0;
    default: return hostFocusMessage(message, wParam, lParam);
  }
}

LRESULT WinPanel::hostFocusMessage(UINT message, WPARAM wParam, LPARAM lParam) {
  switch (message) {
    case WM_MOUSEACTIVATE: return MA_ACTIVATE;
    case WM_SETFOCUS:
      focusPage();
      pushTheme();
      return 0;
    case WM_PARENTNOTIFY:
      if (LOWORD(wParam) == WM_LBUTTONDOWN) focusPage();
      break;
    default: break;
  }
  return DefWindowProcW(host_, message, wParam, lParam);
}

void WinPanel::containerMessage(UINT message, WPARAM wParam) {
  if (message == WM_SIZE || message == WM_SHOWWINDOW) trackFrame();
  if (message == WM_SIZE && host_ != nullptr) {
    RECT area{};
    GetClientRect(container_, &area);
    MoveWindow(host_, 0, 0, area.right - area.left, area.bottom - area.top, TRUE);
  } else if (message == WM_SHOWWINDOW) {
    setShown(wParam != 0);
  } else if (message == WM_DESTROY) {
    logLine("panel: container destroyed");
    close();
  }
}

void WinPanel::trackFrame() {
  HWND frame = floatingFrameOf(container_);
  if (frame == frame_) return;
  releaseFrame();
  frame_ = frame;
  if (frame_ == nullptr) return;
  sdkwin::subclassWindow(frame_, frameProc);
  logLine("panel: floating window minimum content size " + std::to_string(kPanelMinimumWidth) + "x" +
          std::to_string(kPanelMinimumHeight));
}

void WinPanel::releaseFrame() {
  HWND frame = std::exchange(frame_, nullptr);
  if (frame == nullptr) return;
  for (const std::unique_ptr<WinPanel>& other : livePanels()) {
    if (other.get() != this && other->usesFrame(frame)) return;
  }
  if (IsWindow(frame) != FALSE) sdkwin::releaseSubclass(frame, frameProc);
}

void WinPanel::focusPage() {
  if (controller_) controller_->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
}

void WinPanel::noteFocus(bool gained) {
  if (gained) {
    pageHasFocus_ = true;
  } else if (GetForegroundWindow() == GetAncestor(host_, GA_ROOT)) {
    pageHasFocus_ = false;
  }
}

void WinPanel::foregroundChanged(HWND foreground) {
  if (host_ == nullptr) return;
  if (foreground != GetAncestor(host_, GA_ROOT)) {
    refocusOnReturn_ = pageHasFocus_;
  } else if (refocusOnReturn_) {
    SetTimer(host_, kTimerRefocus, kRefocusDelayMs, nullptr);
  }
}

void WinPanel::onRefocusTimer() {
  KillTimer(host_, kTimerRefocus);
  if (!std::exchange(refocusOnReturn_, false)) return;
  logLine("panel: the window is active again, giving the keyboard back to the web view");
  focusPage();
}

void WinPanel::close() {
  if (!alive_) return;
  alive_ = false;
  if (container_ != nullptr && IsWindow(container_) != FALSE) sdkwin::unbindContainerPanel(container_);
  ++scriptGeneration_;
  releaseFrame();
  if (host_ != nullptr) {
    KillTimer(host_, kTimerSession);
    KillTimer(host_, kTimerRefocus);
    sdkwin::unbindHostPanel(host_);
  }
  if (controller_) controller_->Close();
  view_.reset();
  controller_.reset();
  environment_.reset();
  if (host_ != nullptr && IsWindow(host_) != FALSE) DestroyWindow(host_);
  host_ = nullptr;
}

void unregisterHostClass() { UnregisterClassW(kHostClass, moduleOfThisCode()); }

}

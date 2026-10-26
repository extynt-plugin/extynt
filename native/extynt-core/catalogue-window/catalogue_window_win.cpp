// extynt Catalogue.exe: the small window the Windows installer opens after install, which starts the effect catalogue
// in After Effects' hidden second instance, follows it and says what was learned and skipped (ADR 0043). Run with
// `--preview-screenshots <dir> [light|dark]` or `--preview-window [light|dark]` it shows canned states instead.
#include <windows.h>
#include <objidl.h>

#include <algorithm>
#include <cmath>
#include <memory>
#include <iterator>
#include <optional>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include <dwmapi.h>
#include <uxtheme.h>

#include <gdiplus.h>

#include "canned_status.h"
#include "catalogue_engine_win.h"
#include "catalogue_launch_win.h"
#include "catalogue_preview_win.h"
#include "catalogue_program.h"
#include "catalogue_status.h"
#include "catalogue_view_win.h"
#include "catalogue_window_resource.h"
#include "sdk_win_catalogue.h"
#include "session_port.h"
#include "windows_paths.h"

#pragma comment( \
    linker,      \
    "\"/manifestdependency:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'\"")

namespace {

using namespace extynt::catalogue;

constexpr const wchar_t* kClassName = L"extyntCatalogueWindow";
constexpr const wchar_t* kMutexName = L"Local\\extynt-catalogue-window";
constexpr UINT_PTR kPollTimer = 1, kFrameTimer = 2;
constexpr UINT kFrameMilliseconds = 16;
constexpr UINT kAnswer = WM_APP + 1;
constexpr int kDoneId = IDOK, kRetryId = 1003;
constexpr float kMargin = 16;
constexpr double kPreviewStepSeconds = 2.5;
constexpr std::size_t kPreviewLanguageIndex = 2;
constexpr DWORD kImmersiveDarkMode = 20;

double secondsNow() { return static_cast<double>(GetTickCount64()) / 1000.0; }

bool appsUseDarkTheme() {
  DWORD value = 1;
  DWORD size = sizeof(value);
  if (RegGetValueW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
                   L"AppsUseLightTheme", RRF_RT_REG_DWORD, nullptr, &value, &size) != ERROR_SUCCESS) {
    return false;
  }
  return value == 0;
}

std::wstring wideText(Language language, Text key) { return extynt::win::widen(say(language, key)); }

int scaled(float dips, float scale) { return static_cast<int>(std::lround(dips * scale)); }

class CatalogueWindow {
 public:
  explicit CatalogueWindow(bool previewing, std::optional<bool> forcedDark, Language language)
      : poller_(view_.page, secondsNow()),
        previewing_(previewing),
        forcedDark_(forcedDark),
        canned_(cannedStatuses(language)) {
    view_.page.language = language;
    view_.page.showStarting();
  }

  static HICON loadLogo(HINSTANCE instance, int cx, int cy) {
    return static_cast<HICON>(LoadImageW(instance, MAKEINTRESOURCEW(IDI_EXTYNT), IMAGE_ICON, GetSystemMetrics(cx),
                                         GetSystemMetrics(cy), LR_DEFAULTCOLOR | LR_SHARED));
  }

  bool create(HINSTANCE instance, bool preview) {
    WNDCLASSEXW windowClass = {};
    windowClass.cbSize = sizeof(windowClass);
    windowClass.lpfnWndProc = &CatalogueWindow::dispatch;
    windowClass.hInstance = instance;
    windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    windowClass.hIcon = loadLogo(instance, SM_CXICON, SM_CYICON);
    windowClass.hIconSm = loadLogo(instance, SM_CXSMICON, SM_CYSMICON);
    windowClass.lpszClassName = kClassName;
    if (RegisterClassExW(&windowClass) == 0) return false;
    const DWORD style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_CLIPCHILDREN;
    const DWORD exStyle = WS_EX_TOPMOST;
    RECT outer = {0, 0, static_cast<LONG>(CatalogueView::kWidth),
                  static_cast<LONG>(CatalogueView::kPageHeight + CatalogueView::kFooter)};
    AdjustWindowRectEx(&outer, style, FALSE, exStyle);
    std::wstring title = L"extynt";
    if (preview) title = wideText(view_.page.language, Text::WindowPreviewTitle);
    hwnd_ = CreateWindowExW(exStyle, kClassName, title.c_str(), style, CW_USEDEFAULT, CW_USEDEFAULT,
                            outer.right - outer.left, outer.bottom - outer.top, nullptr, nullptr, instance, this);
    return hwnd_ != nullptr;
  }

  void show() {
    fitToDpi();
    center();
    ShowWindow(hwnd_, SW_SHOW);
    SetForegroundWindow(hwnd_);
    SetFocus(done_);
    UpdateWindow(hwnd_);
  }

 private:
  static LRESULT CALLBACK dispatch(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    if (message == WM_NCCREATE) {
      auto* created = sdkcatalogue::creationInstance<CatalogueWindow>(lParam);
      created->hwnd_ = window;
      sdkcatalogue::storeInstance(window, created);
    }
    auto* self = sdkcatalogue::storedInstance<CatalogueWindow>(window);
    if (self == nullptr) return DefWindowProcW(window, message, wParam, lParam);
    return self->handle(message, wParam, lParam);
  }

  [[nodiscard]] float scale() const { return static_cast<float>(sdkcatalogue::dpiOfWindow(hwnd_)) / 96.0F; }

  void fitToDpi() {
    const float s = scale();
    RECT outer = {0, 0, scaled(CatalogueView::kWidth, s),
                  scaled(CatalogueView::kPageHeight + CatalogueView::kFooter, s)};
    if (!sdkcatalogue::adjustWindowRectForDpi(outer, static_cast<DWORD>(GetWindowLongPtrW(hwnd_, GWL_STYLE)),
                                              static_cast<DWORD>(GetWindowLongPtrW(hwnd_, GWL_EXSTYLE)),
                                              sdkcatalogue::dpiOfWindow(hwnd_))) {
      return;
    }
    SetWindowPos(hwnd_, nullptr, 0, 0, outer.right - outer.left, outer.bottom - outer.top,
                 SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
    layoutButton();
  }

  void center() {
    RECT bounds;
    GetWindowRect(hwnd_, &bounds);
    MONITORINFO info = {};
    info.cbSize = sizeof(info);
    GetMonitorInfoW(MonitorFromWindow(hwnd_, MONITOR_DEFAULTTOPRIMARY), &info);
    const int x = info.rcWork.left + (((info.rcWork.right - info.rcWork.left) - (bounds.right - bounds.left)) / 2);
    const int y = info.rcWork.top + (((info.rcWork.bottom - info.rcWork.top) - (bounds.bottom - bounds.top)) / 2);
    SetWindowPos(hwnd_, HWND_TOPMOST, x, y, 0, 0, SWP_NOSIZE | SWP_NOACTIVATE);
  }

  void applyTheme() {
    const bool dark = forcedDark_ ? *forcedDark_ : appsUseDarkTheme();
    view_.setDark(dark);
    const BOOL immersive = dark ? TRUE : FALSE;
    DwmSetWindowAttribute(hwnd_, kImmersiveDarkMode, &immersive, sizeof(immersive));
    if (done_) SetWindowTheme(done_, dark ? L"DarkMode_Explorer" : L"Explorer", nullptr);
    if (retry_) SetWindowTheme(retry_, dark ? L"DarkMode_Explorer" : L"Explorer", nullptr);
    InvalidateRect(hwnd_, nullptr, FALSE);
  }

  void layoutButton() {
    const float s = scale();
    const float pageHeight = CatalogueView::kPageHeight;
    MoveWindow(done_, scaled(CatalogueView::kWidth - kMargin - 88, s), scaled(pageHeight + 12, s), scaled(88, s),
               scaled(28, s), TRUE);
    MoveWindow(retry_, scaled(CatalogueView::kWidth - kMargin - 88 - 8 - 88, s), scaled(pageHeight + 12, s),
               scaled(88, s), scaled(28, s), TRUE);
    if (buttonFont_) DeleteObject(buttonFont_);
    buttonFont_ =
        CreateFontW(-scaled(12, s), 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS,
                    CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_DONTCARE, L"Segoe UI");
    sdkcatalogue::setControlFont(done_, buttonFont_);
    sdkcatalogue::setControlFont(retry_, buttonFont_);
  }

  void labelButtons() {
    const Language language = view_.page.language;
    SetWindowTextW(done_, wideText(language, Text::WindowDone).c_str());
    SetWindowTextW(retry_, wideText(language, Text::WindowRetry).c_str());
    labelled_ = language;
  }

  void syncFooter() {
    if (labelled_ != view_.page.language) labelButtons();
    view_.footnote = extynt::win::widen(view_.page.footnote);
    ShowWindow(retry_, view_.page.retryable ? SW_SHOW : SW_HIDE);
    InvalidateRect(hwnd_, nullptr, FALSE);
  }

  void send(Poller::Next request) {
    if (request == Poller::Next::Nothing || !endpoint_) return;
    poller_.sent(request);
    HWND window = hwnd_;
    const extynt::SessionEndpoint endpoint = *endpoint_;
    const bool post = request == Poller::Next::Post;
    std::thread([window, endpoint, post, queue = answers_] {
      queue->push(requestEngine(endpoint, post));
      PostMessageW(window, kAnswer, 0, 0);
    }).detach();
  }

  void poll() {
    const double now = secondsNow();
    if (previewing_) {
      if (nextCanned_ < canned_.size() && now - previewAt_ >= kPreviewStepSeconds) {
        view_.page.render(canned_[nextCanned_++].status);
        view_.syncBar();
        previewAt_ = now;
        syncFooter();
      }
      return;
    }
    const std::optional<extynt::SessionEndpoint> latest = readSession();
    if (sessionMoved(endpoint_, latest)) poller_.sessionChanged();
    if (latest) endpoint_ = latest;
    const Poller::Next request = poller_.tick(now, endpoint_.has_value());
    view_.syncBar();
    if (poller_.closeDue(now)) {
      DestroyWindow(hwnd_);
      return;
    }
    send(request);
    InvalidateRect(hwnd_, nullptr, FALSE);
  }

  void frame() {
    const unsigned dirty = view_.step(secondsNow());
    if (dirty == CatalogueView::kNothing) return;
    const float s = scale();
    RECT area = {0, 0, scaled(CatalogueView::kWidth, s), scaled(CatalogueView::kPageHeight, s)};
    if (dirty == CatalogueView::kBar) {
      area.top = scaled(92 - 1, s);
      area.bottom = scaled(102 + 1, s);
    }
    InvalidateRect(hwnd_, &area, FALSE);
  }

  void paint() {
    PAINTSTRUCT paintStruct;
    HDC dc = BeginPaint(hwnd_, &paintStruct);
    const std::unique_ptr<Gdiplus::Bitmap> bitmap = view_.render(scale(), secondsNow(), true);
    Gdiplus::Graphics screen(dc);
    screen.DrawImage(bitmap.get(), 0, 0, static_cast<INT>(bitmap->GetWidth()), static_cast<INT>(bitmap->GetHeight()));
    EndPaint(hwnd_, &paintStruct);
  }

  void onCreate() {
    done_ = sdkcatalogue::createDefaultButton(hwnd_, L"", kDoneId);
    retry_ = sdkcatalogue::createPushButton(hwnd_, L"", kRetryId);
    labelButtons();
    layoutButton();
    applyTheme();
    syncFooter();
    view_.syncBar();
    SetTimer(hwnd_, kPollTimer, static_cast<UINT>(kPollSeconds * 1000), nullptr);
    SetTimer(hwnd_, kFrameTimer, kFrameMilliseconds, nullptr);
    PostMessageW(hwnd_, WM_TIMER, kPollTimer, 0);
  }

  void onTimer(WPARAM timer) {
    if (timer == kPollTimer) poll();
    if (timer == kFrameTimer) frame();
  }

  void onAnswer() {
    for (const std::optional<Status>& answer : answers_->drain()) {
      poller_.received(answer, secondsNow());
      view_.syncBar();
      syncFooter();
    }
  }

  void onDpiChanged(LPARAM parameter) {
    const RECT suggested = sdkcatalogue::dpiSuggestedRect(parameter);
    SetWindowPos(hwnd_, HWND_TOPMOST, suggested.left, suggested.top, suggested.right - suggested.left,
                 suggested.bottom - suggested.top, SWP_NOACTIVATE);
    layoutButton();
    InvalidateRect(hwnd_, nullptr, FALSE);
  }

  void onCommand(WPARAM wParam) {
    if (LOWORD(wParam) == kDoneId || LOWORD(wParam) == IDCANCEL) DestroyWindow(hwnd_);
    if (LOWORD(wParam) == kRetryId) {
      poller_.retry();
      syncFooter();
    }
  }

  void onDestroy() {
    KillTimer(hwnd_, kPollTimer);
    KillTimer(hwnd_, kFrameTimer);
    if (buttonFont_) DeleteObject(buttonFont_);
    buttonFont_ = nullptr;
    PostQuitMessage(0);
  }

  LRESULT handle(UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
      case WM_CREATE: onCreate(); return 0;
      case WM_TIMER: onTimer(wParam); return 0;
      case kAnswer: onAnswer(); return 0;
      case WM_COMMAND: onCommand(wParam); return 0;
      case WM_ERASEBKGND: return 1;
      case WM_PAINT: paint(); return 0;
      default: return handleSystem(message, wParam, lParam);
    }
  }

  LRESULT handleSystem(UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
      case WM_DPICHANGED: onDpiChanged(lParam); return 0;
      case WM_SETTINGCHANGE:
      case WM_THEMECHANGED: applyTheme(); return DefWindowProcW(hwnd_, message, wParam, lParam);
      case WM_DESTROY: onDestroy(); return 0;
      default: return DefWindowProcW(hwnd_, message, wParam, lParam);
    }
  }

  std::shared_ptr<AnswerQueue> answers_ = std::make_shared<AnswerQueue>();
  CatalogueView view_;
  Poller poller_;
  bool previewing_;
  std::optional<bool> forcedDark_;
  std::vector<CannedStatus> canned_;
  Language labelled_ = Language::En;
  std::optional<extynt::SessionEndpoint> endpoint_;
  std::size_t nextCanned_ = 0;
  double previewAt_ = secondsNow();
  HWND hwnd_ = nullptr;
  HWND done_ = nullptr;
  HWND retry_ = nullptr;
  HFONT buttonFont_ = nullptr;
};

int runLoop() {
  MSG message;
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    if (message.message == WM_KEYDOWN && message.wParam == VK_ESCAPE) {
      PostMessageW(GetAncestor(message.hwnd, GA_ROOT), WM_COMMAND, IDCANCEL, 0);
      continue;
    }
    if (message.message == WM_KEYDOWN && message.wParam == VK_RETURN) {
      PostMessageW(GetAncestor(message.hwnd, GA_ROOT), WM_COMMAND, kDoneId, 0);
      continue;
    }
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
  return 0;
}

Language previewLanguage(const std::vector<std::wstring>& arguments, bool preview) {
  return preview ? languageArgument(arguments, kPreviewLanguageIndex) : Language::En;
}

int runCatalogue(HINSTANCE instance, const std::vector<std::wstring>& arguments) {
  const bool preview = firstArgumentIs(arguments, L"--preview-window");

  HANDLE single = preview ? nullptr : CreateMutexW(nullptr, FALSE, kMutexName);
  if (single && GetLastError() == ERROR_ALREADY_EXISTS) {
    HWND existing = FindWindowW(kClassName, nullptr);
    if (existing) SetForegroundWindow(existing);
    CloseHandle(single);
    return 0;
  }

  CatalogueWindow window(preview, preview ? themeArgument(arguments, 1) : std::nullopt,
                         previewLanguage(arguments, preview));
  if (!window.create(instance, preview)) return 1;
  window.show();
  const int result = runLoop();
  if (single) CloseHandle(single);
  return result;
}

}

namespace extynt::catalogue {

int runCatalogueProgram(HINSTANCE instance) {
  const std::vector<std::wstring> arguments = commandLineArguments();
  const GdiplusSession gdiplus;

  if (firstArgumentIs(arguments, L"--preview-screenshots")) return runPreviewScreenshots(arguments);
  return runCatalogue(instance, arguments);
}

}

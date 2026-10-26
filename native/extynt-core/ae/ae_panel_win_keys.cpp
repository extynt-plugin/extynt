// The key hook and the key log. See ae_panel_win_keys.h. WH_GETMESSAGE sees every message the main thread's loop
// removes, before it is translated or dispatched: this is where After Effects' own accelerators would take a key. A
// forced key is sent to the page through the DevTools protocol and the message becomes WM_NULL, so the page gets it
// exactly once and After Effects never does.
#include "ae_panel_win_keys.h"

#include <windows.h>

#include <array>
#include <charconv>
#include <optional>
#include <string>

#include "ae_log.h"
#include "ae_panel_win.h"
#include "ae_panel_win_panel.h"
#include "sdk_win_window.h"

namespace extynt::ae::panel {

namespace {

HHOOK& hookHandle() {
  static HHOOK hook = nullptr;
  return hook;
}

bool keyIsDown(int virtualKey) { return (GetKeyState(virtualKey) & 0x8000) != 0; }

const char* routeText(WinKeyRoute route) {
  switch (route) {
    case WinKeyRoute::Host: return "host";
    case WinKeyRoute::PageNative: return "page";
    case WinKeyRoute::PageForced: return "forced";
  }
  return "host";
}

std::string hexText(unsigned value) {
  constexpr int kHexBase = 16;
  std::array<char, 16> buffer{};
  const std::to_chars_result written = std::to_chars(buffer.data(), buffer.data() + buffer.size(), value, kHexBase);
  std::string digits(buffer.data(), written.ptr);
  for (char& digit : digits) {
    if (digit >= 'a' && digit <= 'f') digit = static_cast<char>(digit - 'a' + 'A');
  }
  return "0x" + digits;
}

bool deliverForced(WinPanel& panel, const MSG& message) {
  const bool up = message.message == WM_KEYUP;
  const WinKeyEvent event = currentKeyEvent(static_cast<unsigned>(message.wParam));
  const std::optional<std::string> parameters = cdpKeyEventParameters(event, up);
  if (!parameters) return false;
  panel.dispatchKey(*parameters);
  if (panelFlags().logKeys.load() && !up) logLine("panel key: hook delivered " + keyEventText(event));
  return true;
}

bool takeKey(const MSG& message) {
  if (message.message != WM_KEYDOWN && message.message != WM_KEYUP) return false;
  WinPanel* panel = panelContaining(message.hwnd);
  return panel != nullptr && deliverForced(*panel, message);
}

LRESULT CALLBACK keyHookProc(int code, WPARAM removal, LPARAM parameter) noexcept {
  try {
    MSG* message = sdkwin::hookedMessage(parameter);
    if (code == HC_ACTION && removal == PM_REMOVE && panelFlags().keyHook.load() && message != nullptr &&
        takeKey(*message)) {
      message->message = WM_NULL;
    }
  } catch (...) {
    logDroppedException("key hook");
  }
  return CallNextHookEx(hookHandle(), code, removal, parameter);
}

}

WinKeyEvent currentKeyEvent(unsigned virtualKey) {
  WinKeyEvent event;
  event.virtualKey = virtualKey;
  event.ctrl = keyIsDown(VK_CONTROL);
  event.shift = keyIsDown(VK_SHIFT);
  event.alt = keyIsDown(VK_MENU);
  return event;
}

std::string keyEventText(const WinKeyEvent& event) {
  std::string text;
  if (event.ctrl) text += "Ctrl+";
  if (event.alt) text += "Alt+";
  if (event.shift) text += "Shift+";
  const WinKeyDecision decision = classifyWindowsKey(event);
  text += hexText(event.virtualKey) + " -> " + routeText(decision.route);
  if (!decision.editCommand.empty()) text += " " + decision.editCommand;
  return text;
}

void logAcceleratorKey(unsigned virtualKey, bool down) {
  if (!panelFlags().logKeys.load()) return;
  logLine(std::string("panel key: accelerator ") + (down ? "down " : "up ") +
          keyEventText(currentKeyEvent(virtualKey)));
}

void installKeyHook() {
  if (hookHandle() != nullptr) return;
  hookHandle() = SetWindowsHookExW(WH_GETMESSAGE, keyHookProc, nullptr, GetCurrentThreadId());
  logLine(hookHandle() != nullptr ? "panel: key hook installed on the main thread"
                                  : "panel: key hook install failed, error " + std::to_string(GetLastError()));
}

void removeKeyHook() {
  if (hookHandle() == nullptr) return;
  UnhookWindowsHookEx(hookHandle());
  hookHandle() = nullptr;
}

}

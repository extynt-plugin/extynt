// Which keys the Windows panel must put in front of the page itself because After Effects would otherwise take them,
// and the page-side description of such a key. Pure core: virtual-key codes in, text out. The WebView2 half
// (ae/ae_panel_win_keys.cpp) turns a WM_KEYDOWN into a WinKeyEvent, asks here, and acts on the answer.
#pragma once

#include <optional>
#include <string>

namespace extynt::ae {

// Windows virtual-key codes the classifier knows by name (winuser.h values; this file includes no Windows header).
constexpr unsigned kVkBack = 0x08;
constexpr unsigned kVkTab = 0x09;
constexpr unsigned kVkReturn = 0x0D;
constexpr unsigned kVkEscape = 0x1B;
// Page Up
constexpr unsigned kVkPrior = 0x21;
// Page Down
constexpr unsigned kVkNext = 0x22;
constexpr unsigned kVkEnd = 0x23;
constexpr unsigned kVkHome = 0x24;
constexpr unsigned kVkLeft = 0x25;
constexpr unsigned kVkUp = 0x26;
constexpr unsigned kVkRight = 0x27;
constexpr unsigned kVkDown = 0x28;
constexpr unsigned kVkDelete = 0x2E;

struct WinKeyEvent {
  unsigned virtualKey = 0;
  bool ctrl = false;
  bool shift = false;
  bool alt = false;
};

// Who handles a chord: After Effects (Host), the web view itself (PageNative), or the panel, which delivers it to the
// page because After Effects would take it first (PageForced).
enum class WinKeyRoute : unsigned char { Host, PageNative, PageForced };

struct WinKeyDecision {
  WinKeyRoute route = WinKeyRoute::Host;
  // The Blink editing command for an edit shortcut ("selectAll", "copy", ...), else empty
  std::string editCommand;
};

// Ctrl+A/C/V/X/Z/Y (and Ctrl+Shift+Z) are forced with their editing command; arrows, Home, End, Page Up/Down and
// Escape are forced; plain text keys and Backspace/Delete/Enter/Tab are native; every other Ctrl or Alt chord, and
// every key outside the printable range, belongs to the host. AltGr (Ctrl+Alt together) is text, never a chord.
WinKeyDecision classifyWindowsKey(const WinKeyEvent& event);

// The Chrome DevTools Protocol parameters of Input.dispatchKeyEvent for a forced key, as a JSON object text:
// {"type":"rawKeyDown","windowsVirtualKeyCode":N,"nativeVirtualKeyCode":N,"key":"ArrowLeft","code":"ArrowLeft",
//  "modifiers":N,"commands":["selectAll"]}. `keyUp` selects the "keyUp" type (no commands). nullopt for a key the
// table does not describe.
std::optional<std::string> cdpKeyEventParameters(const WinKeyEvent& event, bool keyUp);

}

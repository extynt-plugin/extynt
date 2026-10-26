// Windows only. The panel's keyboard layers that are not the web view itself: the key log and the main-thread message
// hook that puts edit shortcuts and navigation keys in front of the page before After Effects takes them.
#pragma once

#include <string>

#include "panel_keys_win.h"

namespace extynt::ae::panel {

// The event for `virtualKey` with the modifier keys as they are now (GetKeyState).
WinKeyEvent currentKeyEvent(unsigned virtualKey);

// "Ctrl+Shift+A (0x41) -> forced selectAll", for the log.
std::string keyEventText(const WinKeyEvent& event);

// Logs one accelerator-key notification from the web view ("down" or "up") when key logging is on.
void logAcceleratorKey(unsigned virtualKey, bool down);

// Installs the WH_GETMESSAGE hook on the calling (main) thread once; removes it. Both are safe to repeat. The hook acts
// only while panelFlags().keyHook is on and the focused window belongs to one of our panels.
void installKeyHook();
void removeKeyHook();

}

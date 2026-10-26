// Context-menu trimming and key routing for the macOS panel. Pure core: facts about menu items and key events in,
// decisions out; the Objective-C++ monitor and view do the AppKit work.
#pragma once

#include <cstddef>
#include <optional>
#include <string>
#include <vector>

namespace extynt::ae {

// The identity of one key event, enough to recognise WebKit handing back an event the monitor already routed.
struct KeyStamp {
  double timestamp = 0;
  unsigned short keyCode = 0;
  unsigned long type = 0;
  long windowNumber = 0;
  bool valid = false;
};

// True when `now` is the same physical event as `routed` (same type, key code, window and timestamp).
bool isResendOfRoutedKey(const KeyStamp& routed, const KeyStamp& now);

// An editing command for a plain key that the web view does not take as text: the NSResponder selector name and the
// page script that does the same when nothing in the web view answers it (empty when there is none).
struct EditingKeyCommand {
  std::string selector;
  std::string jsFallback;
};

// Home, End, Page Up and Page Down (macOS key codes 115, 119, 116, 121), with or without Shift (which extends the
// selection). nullopt for every other key.
std::optional<EditingKeyCommand> editingKeyCommand(unsigned short keyCode, bool shift);

// What the context menu says about one item, for the trim decision.
struct MenuItemFacts {
  std::string identifier;
  std::string title;
  std::string action;
  bool hasSubmenu = false;
};

// Cut, Copy, Paste, Select All and Look Up survive; everything else (Spelling, Share, Services, Speech, Search,
// Translate, Font, AutoFill, ...) is removed. Inspect Element survives only when `inspectorAllowed` (a
// development-library build, whose web view is inspectable).
bool keepContextMenuItem(const MenuItemFacts& item, bool inspectorAllowed = false);

// Which of a menu's items (true = separator) a trim must also remove so none leads, trails or follows another
// separator; `kept[i]` says whether item i survived the trim. Returns indices in ascending order.
std::vector<std::size_t> redundantSeparators(const std::vector<bool>& isSeparator, const std::vector<bool>& kept);

}

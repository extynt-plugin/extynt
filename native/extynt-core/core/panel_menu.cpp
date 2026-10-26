// Context-menu trimming and key routing for the macOS panel: which menu items survive, which separators go with them,
// and which plain keys the web view needs an editing command for.

#include "panel_menu.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <initializer_list>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace extynt::ae {

namespace {

std::string lowered(const std::string& text) {
  std::string out = text;
  for (char& c : out) {
    if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
  }
  return out;
}

bool startsWith(const std::string& text, const std::string& prefix) { return text.rfind(prefix, 0) == 0; }

std::string identifierName(const std::string& identifier) {
  for (const char* prefix : {"_WKMenuItemIdentifier", "WKMenuItemIdentifier"}) {
    if (startsWith(identifier, prefix)) return lowered(identifier.substr(std::string(prefix).size()));
  }
  return lowered(identifier);
}

bool oneOf(const std::string& value, std::initializer_list<const char*> choices) {
  return std::any_of(choices.begin(), choices.end(), [&](const char* choice) { return value == choice; });
}

}

bool isResendOfRoutedKey(const KeyStamp& routed, const KeyStamp& now) {
  return routed.valid && now.valid && routed.type == now.type && routed.keyCode == now.keyCode &&
         routed.windowNumber == now.windowNumber && std::fabs(routed.timestamp - now.timestamp) < 1e-6;
}

namespace {

struct EditingKeyRule {
  unsigned short keyCode;
  const char* selector;
  const char* extendingSelector;
  const char* lineDirection;
};

constexpr std::array<EditingKeyRule, 4> kEditingKeyRules{
    {{115, "moveToBeginningOfLine:", "moveToBeginningOfLineAndModifySelection:", "backward"},
     {119, "moveToEndOfLine:", "moveToEndOfLineAndModifySelection:", "forward"},
     {116, "scrollPageUp:", "pageUpAndModifySelection:", ""},
     {121, "scrollPageDown:", "pageDownAndModifySelection:", ""}}};

std::string lineBoundaryScript(const EditingKeyRule& rule, bool shift) {
  if (std::string_view(rule.lineDirection).empty()) return "";
  return std::string("window.getSelection().modify('") + (shift ? "extend" : "move") + "','" + rule.lineDirection +
         "','lineboundary')";
}

}

std::optional<EditingKeyCommand> editingKeyCommand(unsigned short keyCode, bool shift) {
  for (const EditingKeyRule& rule : kEditingKeyRules) {
    if (rule.keyCode == keyCode)
      return EditingKeyCommand{shift ? rule.extendingSelector : rule.selector, lineBoundaryScript(rule, shift)};
  }
  return std::nullopt;
}

bool keepContextMenuItem(const MenuItemFacts& item, bool inspectorAllowed) {
  if (item.hasSubmenu) return false;
  if (inspectorAllowed && identifierName(item.identifier) == "inspectelement") return true;
  if (oneOf(identifierName(item.identifier), {"cut", "copy", "paste", "selectall", "lookup"})) return true;
  if (oneOf(item.action, {"cut:", "copy:", "paste:", "selectAll:"})) return true;
  return oneOf(item.title, {"Cut", "Copy", "Paste", "Select All"}) || startsWith(item.title, "Look Up");
}

std::vector<std::size_t> redundantSeparators(const std::vector<bool>& isSeparator, const std::vector<bool>& kept) {
  std::vector<std::size_t> removed;
  std::vector<std::size_t> live;
  const std::size_t count = std::min(isSeparator.size(), kept.size());
  for (std::size_t i = 0; i < count; ++i) {
    if (!kept[i]) continue;
    if (isSeparator[i] && (live.empty() || isSeparator[live.back()])) {
      removed.push_back(i);
      continue;
    }
    live.push_back(i);
  }
  while (!live.empty() && isSeparator[live.back()]) {
    removed.push_back(live.back());
    live.pop_back();
  }
  std::sort(removed.begin(), removed.end());
  return removed;
}

}

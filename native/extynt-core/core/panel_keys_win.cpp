// Decides which Windows virtual-key chords the panel puts in front of the page, and describes them for the page.

#include "panel_keys_win.h"

#include <array>
#include <optional>
#include <string>

namespace extynt::ae {

namespace {

constexpr unsigned kVkLetterA = 0x41;
constexpr unsigned kVkLetterZ = 0x5A;
constexpr unsigned kVkDigit0 = 0x30;
constexpr unsigned kVkDigit9 = 0x39;
constexpr unsigned kVkSpace = 0x20;
constexpr unsigned kVkOemFirst = 0xBA;
constexpr unsigned kVkOemLast = 0xC0;
constexpr unsigned kVkOemBracketFirst = 0xDB;
constexpr unsigned kVkOemBracketLast = 0xDE;

constexpr int kModifierAlt = 1;
constexpr int kModifierCtrl = 2;
constexpr int kModifierShift = 8;

bool isLetter(unsigned vk) { return vk >= kVkLetterA && vk <= kVkLetterZ; }

bool isTextKey(unsigned vk) {
  return isLetter(vk) || (vk >= kVkDigit0 && vk <= kVkDigit9) || vk == kVkSpace ||
         (vk >= kVkOemFirst && vk <= kVkOemLast) || (vk >= kVkOemBracketFirst && vk <= kVkOemBracketLast);
}

bool isNavigationKey(unsigned vk) { return (vk >= kVkPrior && vk <= kVkDown) || vk == kVkEscape; }

std::string editCommandFor(const WinKeyEvent& event) {
  switch (event.virtualKey) {
    case 'A': return "selectAll";
    case 'C': return "copy";
    case 'V': return "paste";
    case 'X': return "cut";
    case 'Z': return event.shift ? "redo" : "undo";
    case 'Y': return "redo";
    default: return "";
  }
}

bool isPlainEditKey(unsigned vk) {
  return isTextKey(vk) || vk == kVkBack || vk == kVkDelete || vk == kVkReturn || vk == kVkTab;
}

bool isAltGr(const WinKeyEvent& event) { return event.ctrl && event.alt; }

struct KeyNames {
  const char* key;
  const char* code;
};

struct NamedKey {
  unsigned virtualKey;
  KeyNames names;
};

constexpr std::array<NamedKey, 9> kNamedKeys{{{kVkEscape, {"Escape", "Escape"}},
                                              {kVkPrior, {"PageUp", "PageUp"}},
                                              {kVkNext, {"PageDown", "PageDown"}},
                                              {kVkEnd, {"End", "End"}},
                                              {kVkHome, {"Home", "Home"}},
                                              {kVkLeft, {"ArrowLeft", "ArrowLeft"}},
                                              {kVkUp, {"ArrowUp", "ArrowUp"}},
                                              {kVkRight, {"ArrowRight", "ArrowRight"}},
                                              {kVkDown, {"ArrowDown", "ArrowDown"}}}};

std::optional<KeyNames> namedKey(unsigned vk) {
  for (const NamedKey& key : kNamedKeys) {
    if (key.virtualKey == vk) return key.names;
  }
  return std::nullopt;
}

std::string quoted(const std::string& text) { return "\"" + text + "\""; }

std::string lowerLetter(unsigned vk) {
  std::string letter;
  letter += static_cast<char>(vk - kVkLetterA + 'a');
  return letter;
}

int modifierBits(const WinKeyEvent& event) {
  return (event.alt ? kModifierAlt : 0) | (event.ctrl ? kModifierCtrl : 0) | (event.shift ? kModifierShift : 0);
}

WinKeyDecision classifyUnaltered(const WinKeyEvent& event) {
  WinKeyDecision decision;
  const unsigned vk = event.virtualKey;
  if (isNavigationKey(vk)) {
    decision.route = WinKeyRoute::PageForced;
  } else if (event.ctrl) {
    decision.editCommand = isLetter(vk) ? editCommandFor(event) : std::string();
    if (!decision.editCommand.empty()) decision.route = WinKeyRoute::PageForced;
  } else if (isPlainEditKey(vk)) {
    decision.route = WinKeyRoute::PageNative;
  }
  return decision;
}

}

WinKeyDecision classifyWindowsKey(const WinKeyEvent& event) {
  WinKeyDecision decision;
  const unsigned vk = event.virtualKey;
  if (isAltGr(event)) {
    decision.route = isTextKey(vk) ? WinKeyRoute::PageNative : WinKeyRoute::Host;
  } else if (!event.alt) {
    decision = classifyUnaltered(event);
  }
  return decision;
}

std::optional<std::string> cdpKeyEventParameters(const WinKeyEvent& event, bool keyUp) {
  const WinKeyDecision decision = classifyWindowsKey(event);
  if (decision.route != WinKeyRoute::PageForced) return std::nullopt;
  std::string key;
  std::string code;
  if (const std::optional<KeyNames> names = namedKey(event.virtualKey)) {
    key = names->key;
    code = names->code;
  } else if (isLetter(event.virtualKey)) {
    key = lowerLetter(event.virtualKey);
    code = "Key" + std::string(1, static_cast<char>(event.virtualKey));
  } else {
    return std::nullopt;
  }
  const std::string vk = std::to_string(event.virtualKey);
  std::string json = std::string("{\"type\":") + (keyUp ? "\"keyUp\"" : "\"rawKeyDown\"") +
                     ",\"windowsVirtualKeyCode\":" + vk + ",\"nativeVirtualKeyCode\":" + vk +
                     ",\"key\":" + quoted(key) + ",\"code\":" + quoted(code) +
                     ",\"modifiers\":" + std::to_string(modifierBits(event));
  if (!keyUp && !decision.editCommand.empty()) json += ",\"commands\":[" + quoted(decision.editCommand) + "]";
  return json + "}";
}

}

// Shared panel state and the log-text helpers. See ae_panel_diag.h.
#import "ae_panel_diag.h"

#include <array>
#include <charconv>

namespace extynt::ae::panel {

std::atomic<bool> g_logKeys{true};
std::atomic<int> g_createCount{0};

NSHashTable* liveViews() {
  static NSHashTable* table = [NSHashTable weakObjectsHashTable];
  return table;
}

std::string stdString(NSString* text) { return text ? std::string([text UTF8String]) : std::string(); }

std::string className(id object) { return object ? stdString(NSStringFromClass([object class])) : std::string("nil"); }

const char* yesNo(BOOL value) { return value ? "yes" : "no"; }

namespace {

constexpr int kHexBase = 16;
constexpr std::size_t kUnicodeDigits = 4;

std::string lowerCaseHexadecimal(unsigned long value) {
  std::array<char, 24> buffer{};
  const std::to_chars_result written = std::to_chars(buffer.data(), buffer.data() + buffer.size(), value, kHexBase);
  return {buffer.data(), written.ptr};
}

std::string upperCaseHexadecimalPaddedToWidth(unsigned long value, std::size_t width) {
  std::string digits = lowerCaseHexadecimal(value);
  for (char& digit : digits) {
    if (digit >= 'a' && digit <= 'f') digit = static_cast<char>(digit - 'a' + 'A');
  }
  if (digits.size() < width) digits.insert(0, width - digits.size(), '0');
  return digits;
}

}

std::string escapedChars(NSString* text) {
  if (!text) return "nil";
  std::string out = "\"";
  for (NSUInteger i = 0; i < text.length; ++i) {
    const unichar c = [text characterAtIndex:i];
    if (c == '\\') {
      out += "\\\\";
    } else if (c == '"') {
      out += "\\\"";
    } else if (c >= 0x20 && c < 0x7f) {
      out += static_cast<char>(c);
    } else {
      out += "\\u" + upperCaseHexadecimalPaddedToWidth(c, kUnicodeDigits);
    }
  }
  return out + "\"";
}

std::string modifierText(NSEventModifierFlags flags) {
  std::string out;
  if (flags & NSEventModifierFlagCommand) out += "Cmd+";
  if (flags & NSEventModifierFlagControl) out += "Ctrl+";
  if (flags & NSEventModifierFlagOption) out += "Opt+";
  if (flags & NSEventModifierFlagShift) out += "Shift+";
  if (flags & NSEventModifierFlagFunction) out += "Fn+";
  if (out.empty()) return "-";
  out.pop_back();
  return out;
}

std::string windowText(NSWindow* window) {
  if (!window) return "window=nil";
  std::string text = "window=" + className(window) + " visible=" + yesNo(window.visible) +
                     " key=" + yesNo(window.keyWindow) + " main=" + yesNo(window.mainWindow) +
                     " canBecomeKey=" + yesNo(window.canBecomeKeyWindow) +
                     " level=" + std::to_string(static_cast<long>(window.level)) + " styleMask=0x" +
                     lowerCaseHexadecimal(static_cast<unsigned long>(window.styleMask));
  if ([window isKindOfClass:[NSPanel class]]) {
    NSPanel* panel = static_cast<NSPanel*>(window);
    text += std::string(" floatingPanel=") + yesNo(panel.floatingPanel) +
            " becomesKeyOnlyIfNeeded=" + yesNo(panel.becomesKeyOnlyIfNeeded);
  }
  return text;
}

}

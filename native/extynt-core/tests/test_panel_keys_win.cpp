// Tests for the Windows key classifier: which keys the panel keeps and which go back to the host.
#include <string>

#include "panel_keys_win.h"
#include "panel_nav.h"
#include "testing.h"

using namespace extynt::ae;

namespace {

bool has(const std::string& text, const std::string& part) { return text.find(part) != std::string::npos; }

WinKeyEvent key(unsigned vk, bool ctrl = false, bool shift = false, bool alt = false) {
  WinKeyEvent event;
  event.virtualKey = vk;
  event.ctrl = ctrl;
  event.shift = shift;
  event.alt = alt;
  return event;
}

TEST(edit_shortcuts_are_forced_with_their_editing_command) {
  struct Case {
    unsigned vk;
    bool shift;
    const char* command;
  };
  for (const Case& row :
       {Case{'A', false, "selectAll"}, Case{'C', false, "copy"}, Case{'V', false, "paste"}, Case{'X', false, "cut"},
        Case{'Z', false, "undo"}, Case{'Z', true, "redo"}, Case{'Y', false, "redo"}}) {
    const WinKeyDecision decision = classifyWindowsKey(key(row.vk, true, row.shift));
    CHECK(decision.route == WinKeyRoute::PageForced);
    CHECK_EQ(decision.editCommand, std::string(row.command));
  }
}

TEST(navigation_keys_and_escape_are_forced_with_or_without_modifiers) {
  for (const unsigned vk : {kVkLeft, kVkUp, kVkRight, kVkDown, kVkHome, kVkEnd, kVkPrior, kVkNext, kVkEscape}) {
    CHECK(classifyWindowsKey(key(vk)).route == WinKeyRoute::PageForced);
    CHECK(classifyWindowsKey(key(vk, false, true)).route == WinKeyRoute::PageForced);
    CHECK(classifyWindowsKey(key(vk, true)).route == WinKeyRoute::PageForced);
    CHECK(classifyWindowsKey(key(vk)).editCommand.empty());
  }
}

TEST(text_keys_and_plain_editing_keys_are_left_to_the_web_view) {
  for (const unsigned vk : {static_cast<unsigned>('Q'), static_cast<unsigned>('7'), 0x20U, 0xBAU, 0xDEU, kVkBack,
                            kVkDelete, kVkReturn, kVkTab}) {
    CHECK(classifyWindowsKey(key(vk)).route == WinKeyRoute::PageNative);
    CHECK(classifyWindowsKey(key(vk, false, true)).route == WinKeyRoute::PageNative);
  }
}

TEST(other_chords_and_function_keys_stay_with_after_effects) {
  CHECK(classifyWindowsKey(key('S', true)).route == WinKeyRoute::Host);
  CHECK(classifyWindowsKey(key('A', false, false, true)).route == WinKeyRoute::Host);
  CHECK(classifyWindowsKey(key(kVkLeft, false, false, true)).route == WinKeyRoute::Host);
  CHECK(classifyWindowsKey(key(0x70)).route == WinKeyRoute::Host);
  CHECK(classifyWindowsKey(key(0x7B, true)).route == WinKeyRoute::Host);
}

TEST(altgr_is_text_not_a_chord) {
  CHECK(classifyWindowsKey(key('Q', true, false, true)).route == WinKeyRoute::PageNative);
  CHECK(classifyWindowsKey(key(0xBA, true, false, true)).route == WinKeyRoute::PageNative);
  CHECK(classifyWindowsKey(key(0x70, true, false, true)).route == WinKeyRoute::Host);
}

TEST(cdp_key_event_describes_a_forced_key_for_the_page) {
  CHECK_EQ(cdpKeyEventParameters(key('A', true), false).value_or(""),
           std::string("{\"type\":\"rawKeyDown\",\"windowsVirtualKeyCode\":65,\"nativeVirtualKeyCode\":65,"
                       "\"key\":\"a\",\"code\":\"KeyA\",\"modifiers\":2,\"commands\":[\"selectAll\"]}"));
  CHECK_EQ(cdpKeyEventParameters(key(kVkLeft, false, true), false).value_or(""),
           std::string("{\"type\":\"rawKeyDown\",\"windowsVirtualKeyCode\":37,\"nativeVirtualKeyCode\":37,"
                       "\"key\":\"ArrowLeft\",\"code\":\"ArrowLeft\",\"modifiers\":8}"));
  const std::string up = cdpKeyEventParameters(key('Z', true, true), true).value_or("");
  CHECK(has(up, "\"type\":\"keyUp\""));
  CHECK(has(up, "\"modifiers\":10"));
  CHECK(!has(up, "commands"));
}

TEST(cdp_key_event_refuses_keys_that_are_not_forced) {
  CHECK(!cdpKeyEventParameters(key('Q'), false).has_value());
  CHECK(!cdpKeyEventParameters(key('S', true), false).has_value());
  CHECK(!cdpKeyEventParameters(key(kVkBack), true).has_value());
}

TEST(web_errors_that_mean_the_sidecar_is_not_there_show_the_offline_page) {
  for (const int status : {6, 7, 8, 9, 10, 11, 12, 13, 16}) CHECK(webErrorShowsOfflinePage(status));
  for (const int status : {0, 1, 2, 3, 4, 5, 14, 15, 17, 18, 99}) CHECK(!webErrorShowsOfflinePage(status));
}

}

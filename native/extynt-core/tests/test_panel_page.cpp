// Tests for the panel page scripts and routed-key matching.
#include "panel_menu.h"
#include "panel_page.h"
#include <cstddef>
#include <optional>
#include <string>
#include <vector>

#include "testing.h"

using namespace extynt;
using namespace extynt::ae;

namespace {

bool has(const std::string& text, const std::string& part) { return text.find(part) != std::string::npos; }

TEST(panel_page_has_the_probes_and_no_bridge) {
  const std::string page = panelTestPageHtml(7);
  for (const char* part : {"<textarea", "type=\"text\"", "contenteditable=\"true\"", "isComposing", "keydown", "keyup",
                           "compositionstart", "navigator.clipboard", "fetch(url", "extyntLoads"}) {
    CHECK(has(page, part));
  }
  CHECK(has(page, "<b>7</b>"));
  CHECK(!has(page, "{{"));
  CHECK(!has(page, "webkit.messageHandlers"));
}

TEST(panel_page_lists_the_keys_to_try_with_counters_and_reads_the_injected_port) {
  const std::string page = panelTestPageHtml(1);
  for (const char* key : {"\"Left\"", "\"Escape\"", "\"Cmd+A\"", "\"Cmd+C\"", "\"Cmd+V\"", "\"Cmd+X\"", "\"Cmd+Z\"",
                          "\"Shift+Cmd+Z\"", "\"Home\"", "\"Opt+E\"", "\"Tab\""})
    CHECK(has(page, key));
  CHECK(has(page, "keyTable"));
  CHECK(has(page, "Do NOT press Cmd+S"));
  CHECK(has(page, "window.__extyntNative"));
  CHECK(has(page, "info.sidecarPort"));
  CHECK(!has(page, "value=\"http://127.0.0.1:3210"));
}

TEST(field_hardening_script_sets_every_attribute_and_watches_for_new_fields) {
  const std::string script = panelFieldHardeningScript();
  for (const char* part : {"spellcheck: 'false'", "autocorrect: 'off'", "autocomplete: 'off'", "autocapitalize: 'off'",
                           "writingsuggestions: 'false'", "input, textarea, [contenteditable]", "MutationObserver",
                           "childList: true", "subtree: true", "observe(document"}) {
    CHECK(has(script, part));
  }
  CHECK(!has(script, "alert("));
}

TEST(dialog_shim_answers_at_once_and_blocks_pickers) {
  const std::string script = panelDialogShimScript();
  for (const char* part : {"'alert'", "'confirm'", "return false", "'prompt'", "return null", "showOpenFilePicker",
                           "showSaveFilePicker", "showDirectoryPicker", "AbortError", "this.type === 'file'"}) {
    CHECK(has(script, part));
  }
}

KeyStamp stamp(double timestamp, unsigned short keyCode) {
  KeyStamp out;
  out.timestamp = timestamp;
  out.keyCode = keyCode;
  out.type = 10;
  out.windowNumber = 4;
  out.valid = true;
  return out;
}

TEST(a_resent_key_matches_the_routed_one_and_nothing_else) {
  const KeyStamp routed = stamp(1234.5, 115);
  CHECK(isResendOfRoutedKey(routed, stamp(1234.5, 115)));
  CHECK(!isResendOfRoutedKey(routed, stamp(1234.6, 115)));
  CHECK(!isResendOfRoutedKey(routed, stamp(1234.5, 119)));
  KeyStamp up = stamp(1234.5, 115);
  up.type = 11;
  CHECK(!isResendOfRoutedKey(routed, up));
  KeyStamp elsewhere = stamp(1234.5, 115);
  elsewhere.windowNumber = 5;
  CHECK(!isResendOfRoutedKey(routed, elsewhere));
  CHECK(!isResendOfRoutedKey(KeyStamp{}, KeyStamp{}));
}

std::string selectorOf(int keyCode, bool shift) {
  const std::optional<EditingKeyCommand> command = editingKeyCommand(static_cast<unsigned short>(keyCode), shift);
  return command ? command->selector : std::string("none");
}

std::string fallbackOf(int keyCode, bool shift) {
  const std::optional<EditingKeyCommand> command = editingKeyCommand(static_cast<unsigned short>(keyCode), shift);
  return command ? command->jsFallback : std::string("none");
}

TEST(home_end_and_page_keys_map_to_editing_commands) {
  CHECK_EQ(selectorOf(115, false), std::string("moveToBeginningOfLine:"));
  CHECK_EQ(selectorOf(119, false), std::string("moveToEndOfLine:"));
  CHECK_EQ(selectorOf(115, true), std::string("moveToBeginningOfLineAndModifySelection:"));
  CHECK_EQ(selectorOf(119, true), std::string("moveToEndOfLineAndModifySelection:"));
  CHECK_EQ(selectorOf(116, false), std::string("scrollPageUp:"));
  CHECK_EQ(selectorOf(121, true), std::string("pageDownAndModifySelection:"));
  CHECK(has(fallbackOf(115, false), "'move','backward','lineboundary'"));
  CHECK(has(fallbackOf(119, true), "'extend','forward','lineboundary'"));
  CHECK(fallbackOf(116, false).empty());
  for (const int other : {0, 36, 48, 51, 117, 123, 126}) CHECK_EQ(selectorOf(other, false), std::string("none"));
}

MenuItemFacts item(const std::string& identifier, const std::string& title, const std::string& action = "") {
  MenuItemFacts facts;
  facts.identifier = identifier;
  facts.title = title;
  facts.action = action;
  return facts;
}

TEST(context_menu_keeps_only_the_five_edit_items) {
  CHECK(keepContextMenuItem(item("WKMenuItemIdentifierCut", "Cut")));
  CHECK(keepContextMenuItem(item("WKMenuItemIdentifierCopy", "Copy")));
  CHECK(keepContextMenuItem(item("WKMenuItemIdentifierPaste", "Paste")));
  CHECK(keepContextMenuItem(item("WKMenuItemIdentifierLookUp", "Look Up \"word\"")));
  CHECK(keepContextMenuItem(item("_WKMenuItemIdentifierSelectAll", "Select All")));
  CHECK(keepContextMenuItem(item("", "Localised", "selectAll:")));
  CHECK(keepContextMenuItem(item("", "Look Up Something")));
  for (const char* dropped :
       {"WKMenuItemIdentifierShareMenu", "WKMenuItemIdentifierSpeechMenu", "WKMenuItemIdentifierSearchWeb",
        "WKMenuItemIdentifierCopyImage", "WKMenuItemIdentifierCopyLink", "WKMenuItemIdentifierInspectElement"}) {
    CHECK(!keepContextMenuItem(item(dropped, "Anything")));
  }
  for (const char* title : {"Spelling and Grammar", "Substitutions", "Services", "Translate", "Search with Google",
                            "No Guesses Found", "Learn Spelling", "Paste and Match Style"}) {
    CHECK(!keepContextMenuItem(item("", title)));
  }
  MenuItemFacts services = item("", "Copy");
  services.hasSubmenu = true;
  CHECK(!keepContextMenuItem(services));
}

TEST(inspect_element_survives_only_where_the_inspector_is_allowed) {
  CHECK(keepContextMenuItem(item("WKMenuItemIdentifierInspectElement", "Inspect Element"), true));
  CHECK(!keepContextMenuItem(item("WKMenuItemIdentifierInspectElement", "Inspect Element"), false));
  CHECK(!keepContextMenuItem(item("WKMenuItemIdentifierShareMenu", "Share"), true));
  MenuItemFacts autofill = item("", "AutoFill");
  autofill.hasSubmenu = true;
  CHECK(!keepContextMenuItem(autofill, true));
}

TEST(separators_never_lead_trail_or_double_after_a_trim) {
  using Flags = std::vector<bool>;
  using Indices = std::vector<std::size_t>;
  CHECK(redundantSeparators(Flags{true, false, true, true, false, true}, Flags(6, true)) == (Indices{0, 3, 5}));
  CHECK(redundantSeparators(Flags{false, true, false, true, false}, Flags{true, true, false, true, true}) ==
        (Indices{3}));
  CHECK(redundantSeparators(Flags{true, true}, Flags{true, true}) == (Indices{0, 1}));
  CHECK(redundantSeparators({}, {}).empty());
}

}

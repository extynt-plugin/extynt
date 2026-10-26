// The catalogue window's six-language text table (catalogue-window/catalogue_text.h): every key in every language, the
// same {placeholders} everywhere, plural selection, the English fallback and a fill that never reads a value as a
// template.
#include <array>
#include <cstddef>
#include <optional>
#include <set>
#include <string>
#include <string_view>

#include "canned_status.h"
#include "catalogue_status.h"
#include "catalogue_text.h"
#include "testing.h"

using namespace extynt::catalogue;

namespace {

constexpr std::array<Language, kLanguageCount> kLanguages = {Language::En, Language::Es, Language::De,
                                                             Language::Fr, Language::Ja, Language::ZhHans};

Text keyAt(std::size_t index) { return static_cast<Text>(index); }

std::set<std::string> placeholdersOf(std::string_view text) {
  std::set<std::string> names;
  std::size_t at = 0;
  while ((at = text.find('{', at)) != std::string_view::npos) {
    const std::size_t close = text.find('}', at);
    if (close == std::string_view::npos) {
      names.insert("<unclosed>");
      break;
    }
    names.insert(std::string(text.substr(at + 1, close - at - 1)));
    at = close + 1;
  }
  return names;
}

bool isPluralKey(Text key) { return entryOf(Language::En, key).one != nullptr; }

bool hasText(const char* text) { return text != nullptr && text[0] != '\0'; }

TEST(catalogue_text_every_key_has_all_six_languages) {
  for (const Language language : kLanguages) {
    for (std::size_t index = 0; index < kTextCount; index++) {
      const TextEntry& entry = entryOf(language, keyAt(index));
      CHECK(entry.key == keyAt(index));
      const bool emptyAllowed = keyAt(index) == Text::NoteJoiner;
      CHECK(entry.other != nullptr);
      CHECK(emptyAllowed || hasText(entry.other));
    }
  }
}

TEST(catalogue_text_plural_keys_give_one_and_other_except_in_japanese_and_chinese) {
  std::size_t plurals = 0;
  for (std::size_t index = 0; index < kTextCount; index++) {
    const Text key = keyAt(index);
    if (isPluralKey(key)) plurals++;
    for (const Language language : {Language::Es, Language::De, Language::Fr}) {
      CHECK_EQ(entryOf(language, key).one != nullptr, isPluralKey(key));
    }
    CHECK(entryOf(Language::Ja, key).one == nullptr);
    CHECK(entryOf(Language::ZhHans, key).one == nullptr);
  }
  CHECK(plurals >= 5);
}

TEST(catalogue_text_placeholders_are_identical_in_every_language) {
  for (std::size_t index = 0; index < kTextCount; index++) {
    const Text key = keyAt(index);
    const std::set<std::string> expected = placeholdersOf(entryOf(Language::En, key).other);
    CHECK(expected.count("<unclosed>") == 0);
    for (const Language language : kLanguages) {
      const TextEntry& entry = entryOf(language, key);
      CHECK(placeholdersOf(entry.other) == expected);
      if (entry.one != nullptr) CHECK(placeholdersOf(entry.one) == expected);
    }
  }
}

TEST(catalogue_text_plural_form_follows_each_language) {
  CHECK(pluralFormOf(Language::En, 1) == PluralForm::One);
  CHECK(pluralFormOf(Language::En, 0) == PluralForm::Other);
  CHECK(pluralFormOf(Language::De, 2) == PluralForm::Other);
  CHECK(pluralFormOf(Language::Es, 1) == PluralForm::One);
  CHECK(pluralFormOf(Language::Fr, 0) == PluralForm::One);
  CHECK(pluralFormOf(Language::Fr, 1) == PluralForm::One);
  CHECK(pluralFormOf(Language::Fr, 2) == PluralForm::Other);
  CHECK(pluralFormOf(Language::Ja, 1) == PluralForm::Other);
  CHECK(pluralFormOf(Language::ZhHans, 1) == PluralForm::Other);
}

TEST(catalogue_text_counts_pick_the_right_form_and_fill_count) {
  CHECK_EQ(sayCount(Language::En, Text::VersionCount, 1), std::string("1 version"));
  CHECK_EQ(sayCount(Language::En, Text::VersionCount, 0), std::string("0 versions"));
  CHECK_EQ(sayCount(Language::De, Text::VersionCount, 2), std::string("2 Versionen"));
  CHECK_EQ(sayCount(Language::Fr, Text::VersionCount, 0), std::string("0 version"));
  CHECK_EQ(sayCount(Language::Ja, Text::VersionCount, 1), std::string("1バージョン"));
  CHECK_EQ(sayCount(Language::ZhHans, Text::VersionCount, 3), std::string("3个版本"));
  CHECK_EQ(sayCount(Language::Es, Text::StatusLearned, 1, {{"collected", "1"}}),
           std::string("1 de 1 efecto aprendido"));
}

TEST(catalogue_text_unknown_or_empty_language_is_english) {
  CHECK(languageFromCode("") == Language::En);
  CHECK(languageFromCode("ko") == Language::En);
  CHECK(languageFromCode("zh-Hant") == Language::En);
  CHECK(languageFromCode("de-DE") == Language::En);
  for (const Language language : kLanguages) CHECK(languageFromCode(languageCode(language)) == language);
  CHECK(languageFromCode("zh-Hans") == Language::ZhHans);
  CHECK(languageFromCode("ja") == Language::Ja);
  CHECK_EQ(say(languageFromCode("xx"), Text::WindowDone), std::string("Done"));
  CHECK_EQ(say(languageFromCode("de"), Text::WindowDone), std::string("Fertig"));
}

TEST(catalogue_text_a_value_is_never_read_as_a_template) {
  CHECK_EQ(say(Language::En, Text::HostName, {{"year", "{year}"}}), std::string("After Effects {year}"));
  CHECK_EQ(say(Language::En, Text::HostName, {{"year", "{count}%s%n{"}}), std::string("After Effects {count}%s%n{"));
  CHECK_EQ(say(Language::En, Text::HostName), std::string("After Effects {year}"));
  CHECK_EQ(sayCount(Language::En, Text::CrashedNote, 1, {{"names", "{count}"}}),
           std::string("Skipped {count}. It crashes After Effects, so we leave it alone."));
}

TEST(catalogue_text_japanese_and_chinese_keep_their_own_script_and_punctuation) {
  CHECK_EQ(say(Language::Ja, Text::FinishedDetail), std::string("以上です。「完了」をクリックしてください。"));
  CHECK_EQ(say(Language::ZhHans, Text::FinishedDetail), std::string("好了。请点击“完成”。"));
  CHECK_EQ(say(Language::ZhHans, Text::GaveUpNoHosts), std::string("未找到受支持的After Effects。"));
}

TEST(catalogue_page_speaks_the_language_the_status_names) {
  Page page;
  page.showStarting();
  const Status status = parseResponse(R"({"ok":true,"language":"de","engine":{"state":"idle","hosts":[{"year":"2026",)"
                                      R"("state":"pending","phase":"waiting"}]}})")
                            .value_or(Status{});
  CHECK(status.language == Language::De);
  CHECK(page.render(status) == Outcome::Running);
  CHECK(page.language == Language::De);
  CHECK_EQ(page.heading, std::string("Alle deine Effekte werden gelernt"));
  CHECK_EQ(page.rows[0].tag, std::string("WARTEN"));
  CHECK_EQ(page.rows[0].name, std::string("After Effects 2026"));
  CHECK_EQ(page.versionCount, std::string("1 Version"));
  const std::optional<Status> plain = parseResponse(R"({"ok":true,"engine":{"state":"idle"}})");
  CHECK(plain.has_value() && plain->language == Language::En);
}

TEST(catalogue_every_language_renders_every_canned_state_without_leftover_placeholders) {
  for (const Language language : kLanguages) {
    Page page;
    for (const CannedStatus& canned : cannedStatuses(language)) {
      page.render(canned.status);
      for (const std::string& text : {page.eyebrow, page.heading, page.detail, page.note, page.footnote}) {
        CHECK(text.find('{') == std::string::npos);
      }
    }
    CHECK(page.language == language);
    CHECK(!page.footnote.empty());
  }
}

}

// The lookup behind catalogue_text.h: language codes, plural forms and the one-pass {placeholder} fill.
#include "catalogue_text.h"

#include <array>
#include <cstddef>
#include <string>
#include <string_view>

#include "catalogue_text_tables.h"

namespace extynt::catalogue {

namespace {

constexpr std::array<std::string_view, kLanguageCount> kCodes = {"en", "es", "de", "fr", "ja", "zh-Hans"};

const TextTable& tableOf(Language language) {
  switch (language) {
    case Language::Es: return kSpanishTexts;
    case Language::De: return kGermanTexts;
    case Language::Fr: return kFrenchTexts;
    case Language::Ja: return kJapaneseTexts;
    case Language::ZhHans: return kChineseTexts;
    case Language::En: break;
  }
  return kEnglishTexts;
}

const Argument* findArgument(const Arguments& arguments, std::string_view name) {
  for (const Argument& argument : arguments) {
    if (argument.name == name) return &argument;
  }
  return nullptr;
}

void appendPlaceholder(std::string& out, std::string_view name, const Arguments& arguments) {
  if (const Argument* argument = findArgument(arguments, name)) {
    out += argument->value;
    return;
  }
  out += '{';
  out += name;
  out += '}';
}

std::string fill(std::string_view text, const Arguments& arguments) {
  std::string out;
  std::size_t at = 0;
  while (at < text.size()) {
    const std::size_t open = text.find('{', at);
    const std::size_t close = open == std::string_view::npos ? open : text.find('}', open);
    if (close == std::string_view::npos) {
      out += text.substr(at);
      break;
    }
    out += text.substr(at, open - at);
    appendPlaceholder(out, text.substr(open + 1, close - open - 1), arguments);
    at = close + 1;
  }
  return out;
}

}

Language languageFromCode(std::string_view code) {
  for (std::size_t index = 0; index < kCodes.size(); index++) {
    if (kCodes.at(index) == code) return static_cast<Language>(index);
  }
  return Language::En;
}

std::string_view languageCode(Language language) { return kCodes.at(static_cast<std::size_t>(language)); }

const TextEntry& entryOf(Language language, Text key) { return tableOf(language).at(static_cast<std::size_t>(key)); }

PluralForm pluralFormOf(Language language, long count) {
  if (language == Language::Ja || language == Language::ZhHans) return PluralForm::Other;
  const bool one = count == 1 || (language == Language::Fr && count == 0);
  return one ? PluralForm::One : PluralForm::Other;
}

std::string say(Language language, Text key, const Arguments& arguments) {
  return fill(entryOf(language, key).other, arguments);
}

std::string sayCount(Language language, Text key, long count, const Arguments& arguments) {
  const TextEntry& entry = entryOf(language, key);
  const char* form = pluralFormOf(language, count) == PluralForm::One && entry.one != nullptr ? entry.one : entry.other;
  Arguments all = arguments;
  all.push_back(Argument{"count", std::to_string(count)});
  return fill(form, all);
}

}

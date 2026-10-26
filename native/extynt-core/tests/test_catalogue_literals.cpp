// The catalogue window's converted sources hold no user-visible English: every sentence and label comes from a Text key
// (catalogue-window/catalogue_text.h). A string literal that spells a table entry, or a literal with a space in it that
// is not a font or the effect name of the canned previews, fails here, so a new English literal cannot slip back in.
#include <algorithm>
#include <array>
#include <cstddef>
#include <fstream>
#include <ios>
#include <set>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

#include "catalogue_text.h"
#include "testing.h"

using namespace extynt::catalogue;

namespace {

constexpr std::array<const char*, 10> kConvertedFiles = {
    "catalogue_status.cpp",     "catalogue_status.h",       "canned_status.cpp",         "canned_status.h",
    "catalogue_view_win.cpp",   "catalogue_window_win.cpp", "catalogue_preview_win.cpp", "catalogue_preview_win.h",
    "catalogue_launch_win.cpp", "catalogue_view_win.h"};

constexpr std::array<std::string_view, 5> kNotText = {"IBM Plex", "Segoe UI", "Cascadia", "Remove Grain", "Consolas"};

std::string readSource(const std::string& name) {
  const std::ifstream file(std::string(EXTYNT_CATALOGUE_WINDOW_DIR) + "/" + name, std::ios::binary);
  std::ostringstream text;
  text << file.rdbuf();
  return text.str();
}

bool continuesLine(const std::string& line) { return !line.empty() && line.back() == '\\'; }

std::string withoutDirectives(const std::string& source) {
  std::istringstream lines(source);
  std::string line;
  std::string kept;
  bool directive = false;
  while (std::getline(lines, line)) {
    const std::size_t first = line.find_first_not_of(" \t");
    const bool starts = first != std::string::npos && line[first] == '#';
    if (starts || directive) {
      directive = continuesLine(line);
      continue;
    }
    kept += line + '\n';
  }
  return kept;
}

std::size_t endOfComment(const std::string& text, std::size_t at) {
  const std::size_t end = text.compare(at, 2, "//") == 0 ? text.find('\n', at) : text.find("*/", at);
  return end == std::string::npos ? text.size() : end;
}

std::size_t endOfQuoted(const std::string& text, std::size_t open) {
  for (std::size_t at = open + 1; at < text.size(); at++) {
    if (text[at] == '\\') at++;
    else if (text[at] == text[open]) return at;
  }
  return text.size();
}

std::vector<std::string> literalsOf(const std::string& source) {
  const std::string text = withoutDirectives(source);
  std::vector<std::string> literals;
  for (std::size_t at = 0; at < text.size(); at++) {
    if (text.compare(at, 2, "//") == 0 || text.compare(at, 2, "/*") == 0) {
      at = endOfComment(text, at);
    } else if (text[at] == '"' || text[at] == '\'') {
      const std::size_t close = endOfQuoted(text, at);
      if (text[at] == '"') literals.push_back(text.substr(at + 1, close - at - 1));
      at = close;
    }
  }
  return literals;
}

bool isPlainLowercaseWord(const std::string& text) {
  return std::all_of(text.begin(), text.end(), [](char letter) { return letter >= 'a' && letter <= 'z'; });
}

bool hasLetterAndSpace(const std::string& text) {
  bool letter = false;
  for (const char c : text) letter = letter || (c >= 'A' && c <= 'z');
  return letter && text.find(' ') != std::string::npos;
}

bool startsWithNotText(const std::string& literal) {
  return std::any_of(kNotText.begin(), kNotText.end(),
                     [&](std::string_view prefix) { return literal.rfind(prefix, 0) == 0; });
}

std::set<std::string> tableTexts() {
  std::set<std::string> texts;
  for (std::size_t index = 0; index < kTextCount; index++) {
    for (std::size_t language = 0; language < kLanguageCount; language++) {
      const TextEntry& entry = entryOf(static_cast<Language>(language), static_cast<Text>(index));
      for (const char* form : {entry.one, entry.other}) {
        if (form != nullptr && std::string(form).size() >= 4 && !isPlainLowercaseWord(form)) texts.insert(form);
      }
    }
  }
  return texts;
}

TEST(catalogue_converted_sources_hold_no_table_text_as_literals) {
  const std::set<std::string> texts = tableTexts();
  CHECK(texts.size() > 200);
  for (const char* name : kConvertedFiles) {
    const std::string source = readSource(name);
    CHECK(!source.empty());
    for (const std::string& literal : literalsOf(source)) {
      for (const std::string& text : texts) {
        if (literal.find(text) != std::string::npos) CHECK_EQ(std::string(name) + ": " + literal, std::string());
      }
    }
  }
}

TEST(catalogue_converted_sources_hold_no_sentence_like_literals) {
  for (const char* name : kConvertedFiles) {
    for (const std::string& literal : literalsOf(readSource(name))) {
      if (hasLetterAndSpace(literal) && !startsWithNotText(literal)) {
        CHECK_EQ(std::string(name) + ": " + literal, std::string());
      }
    }
  }
}

TEST(catalogue_literal_scan_does_catch_english_and_skips_comments) {
  const std::vector<std::string> found = literalsOf(
      "// \"Not code here\"\n#include \"x.h\"\nconst char* a = \"Hello there\"; // \"nope\"\nauto b = \"q\\\"r\";\n");
  CHECK_EQ(found.size(), static_cast<std::size_t>(2));
  CHECK_EQ(found[0], std::string("Hello there"));
  CHECK(hasLetterAndSpace(found[0]));
  CHECK_EQ(found[1], std::string("q\\\"r"));
}

}

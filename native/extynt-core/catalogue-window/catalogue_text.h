// Every word "extynt Catalogue.exe" shows, in en, es, de, fr, ja and zh-Hans: a typed key per sentence, named
// {placeholders} filled in one pass (a value is never read as a template, so user data cannot inject text), and
// one/other plural entries. The language is always passed in (the sidecar's interface language reaches the window in
// its engine answers); nothing here reads the operating system. Strings are UTF-8; the Windows code widens them where
// it draws. Pure C++.
#pragma once

#include <cstddef>
#include <string>
#include <string_view>
#include <vector>

namespace extynt::catalogue {

enum class Language { En, Es, De, Fr, Ja, ZhHans };
constexpr std::size_t kLanguageCount = 6;

// The language for a code such as "de" or "zh-Hans"; English for an empty or unknown code.
Language languageFromCode(std::string_view code);
std::string_view languageCode(Language language);

enum class Text {
  WindowDone,
  WindowRetry,
  WindowPreviewTitle,
  ReceiptTitle,
  EyebrowStarting,
  EyebrowLater,
  EyebrowLive,
  EyebrowDone,
  StartingHeading,
  StartingDetail,
  StartingNote,
  GaveUpHeading,
  GaveUpNote,
  GaveUpHelper,
  GaveUpStart,
  GaveUpNoHosts,
  VersionCount,
  HostName,
  TagWaiting,
  TagListing,
  TagRestarting,
  TagLearning,
  TagStarting,
  TagDone,
  TagPartly,
  TagLater,
  StatusRestarting,
  StatusListing,
  StatusLearned,
  StatusLearnedPartly,
  RowTimedOut,
  RowDidntStart,
  RowDidntAnswer,
  RowBlocked,
  RowCrashing,
  RowOpen,
  RowPaused,
  RowUnfinished,
  FootTimedOut,
  FootDidntStart,
  FootDidntAnswer,
  FootBlocked,
  FootCrashing,
  FootPaused,
  FootUnfinished,
  FootOpen,
  LiveProgress,
  LiveUnderMinute,
  LiveMinutes,
  FinishedHeading,
  FinishedDetail,
  FinishedNoneSkipped,
  FailedHeading,
  FailedDetail,
  FailedKept,
  FailedCloseDialog,
  NoteJoiner,
  CrashedNote,
  CrashedListSeparator,
  CrashedListMore,
  LaterNote,
};
constexpr std::size_t kTextCount = static_cast<std::size_t>(Text::LaterNote) + 1;

// One named value for a {placeholder}.
struct Argument {
  std::string_view name;
  std::string value;
};
using Arguments = std::vector<Argument>;

// The text for a key with its {placeholders} filled; an unknown placeholder stays as written.
std::string say(Language language, Text key, const Arguments& arguments = {});
// The text for a plural key: the one/other form `language` uses for `count`, with {count} and the arguments filled.
std::string sayCount(Language language, Text key, long count, const Arguments& arguments = {});

enum class PluralForm { One, Other };
// English, Spanish and German use One for 1; French for 0 and 1; Japanese and Chinese always Other.
PluralForm pluralFormOf(Language language, long count);

// A key's two forms in one language. `one` is null for a key that is not plural and always for ja and zh-Hans.
struct TextEntry {
  Text key;
  const char* one;
  const char* other;
};
// The entry for a key; the tables list the keys in enum order.
const TextEntry& entryOf(Language language, Text key);

}

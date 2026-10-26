// The six per-language tables behind catalogue_text.h, one file each so a translator edits one language. Each lists
// every Text key once, in enum order.
#pragma once

#include <array>

#include "catalogue_text.h"

namespace extynt::catalogue {

using TextTable = std::array<TextEntry, kTextCount>;

extern const TextTable kEnglishTexts;
extern const TextTable kSpanishTexts;
extern const TextTable kGermanTexts;
extern const TextTable kFrenchTexts;
extern const TextTable kJapaneseTexts;
extern const TextTable kChineseTexts;

}

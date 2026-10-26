// Text helpers shared by the AE adapter and the tests. Pure core: no SDK, no OS APIs.
#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace extynt {

// True when the bytes are well-formed UTF-8 (no overlong forms, no surrogates, nothing above U+10FFFF).
bool isValidUtf8(std::string_view bytes);

// Decodes the 8-bit text AEGP_StreamSuite4 (version 9) returns for an expression: UTF-8 when the
// bytes are valid UTF-8, otherwise Latin-1 (every byte one code point). Stops at the first NUL,
// like a C string. StreamSuite5 and later return UTF-16 instead and go through utf16ToUtf8.
std::string decodeEightBitText(std::string_view bytes);

// The integer an ExtendScript result string holds ("1234"), nothing for anything else
// ("undefined", "", "12abc", a negative number, or a value that does not fit 63 bits).
std::optional<int64_t> parseRevisionText(const std::string& text);

}

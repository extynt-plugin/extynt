// UTF-8 helpers shared by the JSON reader and writer and the text decoders. Pure core.
#pragma once

#include <cstddef>
#include <string>

namespace extynt {

// Appends one code point (at most U+10FFFF, never a surrogate) as UTF-8.
inline void appendUtf8(std::string& out, unsigned code) {
  if (code < 0x80) {
    out += static_cast<char>(code);
  } else if (code < 0x800) {
    out += static_cast<char>(0xC0 | (code >> 6));
    out += static_cast<char>(0x80 | (code & 0x3F));
  } else if (code < 0x10000) {
    out += static_cast<char>(0xE0 | (code >> 12));
    out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
    out += static_cast<char>(0x80 | (code & 0x3F));
  } else {
    out += static_cast<char>(0xF0 | (code >> 18));
    out += static_cast<char>(0x80 | ((code >> 12) & 0x3F));
    out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
    out += static_cast<char>(0x80 | (code & 0x3F));
  }
}

namespace utf8_detail {

// What a UTF-8 lead byte announces: the sequence length, and the smallest code point that length may encode (anything
// smaller is an overlong form).
struct Lead {
  size_t length;
  unsigned minimum;
};

inline Lead leadInfo(unsigned lead) {
  if (lead >= 0xC2 && lead <= 0xDF) return {2, 0x80};
  if (lead >= 0xE0 && lead <= 0xEF) return {3, 0x800};
  if (lead >= 0xF0 && lead <= 0xF4) return {4, 0x10000};
  return {0, 0};
}

inline bool validCodePoint(unsigned code, unsigned minimum) {
  const bool surrogate = code >= 0xD800 && code <= 0xDFFF;
  return code >= minimum && code <= 0x10FFFF && !surrogate;
}

}

// Length (1 to 4) of the well-formed UTF-8 sequence at bytes[0], or 0 when it is malformed or cut off by `remaining`.
// Byte is char or unsigned char.
template <typename Byte>
size_t utf8SequenceLength(const Byte* bytes, size_t remaining) {
  const auto lead = static_cast<unsigned char>(bytes[0]);
  if (lead < 0x80) return 1;
  const utf8_detail::Lead info = utf8_detail::leadInfo(lead);
  if (info.length == 0 || info.length > remaining) return 0;
  unsigned code = lead & (0xFFU >> (info.length + 1));
  for (size_t i = 1; i < info.length; ++i) {
    const auto next = static_cast<unsigned char>(bytes[i]);
    if ((next & 0xC0) != 0x80) return 0;
    code = (code << 6) | (next & 0x3FU);
  }
  return utf8_detail::validCodePoint(code, info.minimum) ? info.length : 0;
}

}

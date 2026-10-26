// Validates UTF-8, decodes the host's eight-bit expression text and parses the revision text of an ExtendScript result.

#include "text_decode.h"
#include <cstddef>
#include <string>
#include <optional>
#include <cstdint>
#include <string_view>

#include "utf8.h"

namespace extynt {

namespace {

std::string_view untilNul(std::string_view bytes) { return bytes.substr(0, bytes.find('\0')); }

}

bool isValidUtf8(std::string_view bytes) {
  size_t at = 0;
  while (at < bytes.size()) {
    const size_t length = utf8SequenceLength(bytes.data() + at, bytes.size() - at);
    if (length == 0) return false;
    at += length;
  }
  return true;
}

std::string decodeEightBitText(std::string_view bytes) {
  const std::string_view text = untilNul(bytes);
  if (isValidUtf8(text)) return std::string(text);
  std::string out;
  out.reserve(text.size() + (text.size() / 4));
  for (const char c : text) {
    const auto byte = static_cast<unsigned char>(c);
    if (byte < 0x80) {
      out += c;
    } else {
      out += static_cast<char>(0xC0 | (byte >> 6));
      out += static_cast<char>(0x80 | (byte & 0x3F));
    }
  }
  return out;
}

std::optional<int64_t> parseRevisionText(const std::string& text) {
  if (text.empty() || text.size() > 18) return std::nullopt;
  int64_t value = 0;
  for (const char c : text) {
    if (c < '0' || c > '9') return std::nullopt;
    value = (value * 10) + (c - '0');
  }
  return value;
}

}

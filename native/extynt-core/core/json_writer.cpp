// Implements the streaming JSON writer declared in json_writer.h.
#include "json_writer.h"

#include <cmath>
#include <cstdint>
#include <cstddef>
#include <locale>
#include <sstream>
#include <string>
#include <string_view>

#include "utf8.h"

namespace extynt {

namespace {

constexpr int kShortestPrecision = 15;
constexpr int kExactPrecision = 17;

std::string generalText(double value, int precision) {
  std::ostringstream stream;
  stream.imbue(std::locale::classic());
  stream.precision(precision);
  stream << value;
  return stream.str();
}

bool roundTrips(const std::string& text, double value) {
  std::istringstream stream(text);
  stream.imbue(std::locale::classic());
  double parsed = 0;
  stream >> parsed;
  return !stream.fail() && parsed == value;
}

}

std::string formatDouble(double value) {
  if (value == 0) return "0";
  if (std::fabs(value) < 1e15 && value == std::floor(value)) return std::to_string(static_cast<long long>(value));
  std::string text;
  for (int precision = kShortestPrecision; precision <= kExactPrecision; ++precision) {
    text = generalText(value, precision);
    if (roundTrips(text, value)) break;
  }
  return text;
}

namespace {

void appendHex4(std::string& out, unsigned code) {
  static constexpr std::string_view kDigits = "0123456789abcdef";
  out += "\\u";
  out += kDigits[(code >> 12) & 15];
  out += kDigits[(code >> 8) & 15];
  out += kDigits[(code >> 4) & 15];
  out += kDigits[code & 15];
}

bool isPlainAscii(unsigned char c) { return c >= 0x20 && c < 0x80 && c != '"' && c != '\\'; }

void appendEscaped(std::string& out, unsigned char c) {
  switch (c) {
    case '"': out += "\\\""; break;
    case '\\': out += "\\\\"; break;
    case '\b': out += "\\b"; break;
    case '\f': out += "\\f"; break;
    case '\n': out += "\\n"; break;
    case '\r': out += "\\r"; break;
    case '\t': out += "\\t"; break;
    default: appendHex4(out, c);
  }
}

}

void appendJsonString(std::string& out, std::string_view utf8) {
  out += '"';
  for (size_t i = 0; i < utf8.size();) {
    const auto c = static_cast<unsigned char>(utf8[i]);
    size_t length = 1;
    if (isPlainAscii(c)) {
      out += static_cast<char>(c);
    } else if (c < 0x80) {
      appendEscaped(out, c);
    } else {
      length = utf8SequenceLength(utf8.data() + i, utf8.size() - i);
      if (length == 0) {
        out += "\xEF\xBF\xBD";
        length = 1;
      } else {
        out.append(utf8.data() + i, length);
      }
    }
    i += length;
  }
  out += '"';
}

namespace {

constexpr unsigned kHighSurrogateFirst = 0xD800;
constexpr unsigned kHighSurrogateLast = 0xDBFF;
constexpr unsigned kLowSurrogateFirst = 0xDC00;
constexpr unsigned kLowSurrogateLast = 0xDFFF;
constexpr unsigned kSupplementaryBase = 0x10000;
constexpr unsigned kReplacementCharacter = 0xFFFD;
constexpr unsigned kSurrogateBits = 10;

bool isHighSurrogate(unsigned unit) { return unit >= kHighSurrogateFirst && unit <= kHighSurrogateLast; }

bool isLowSurrogate(unsigned unit) { return unit >= kLowSurrogateFirst && unit <= kLowSurrogateLast; }

struct DecodedUnit {
  unsigned codePoint;
  size_t width;
};

DecodedUnit decodeUtf16(const uint16_t* units, size_t count, size_t index) {
  const unsigned unit = units[index];
  if (isHighSurrogate(unit) && index + 1 < count && isLowSurrogate(units[index + 1])) {
    const unsigned pair = ((unit - kHighSurrogateFirst) << kSurrogateBits) + (units[index + 1] - kLowSurrogateFirst);
    return {kSupplementaryBase + pair, 2};
  }
  if (isHighSurrogate(unit) || isLowSurrogate(unit)) return {kReplacementCharacter, 1};
  return {unit, 1};
}

}

std::string utf16ToUtf8(const uint16_t* units, size_t count) {
  std::string out;
  out.reserve(count);
  for (size_t i = 0; i < count;) {
    const DecodedUnit decoded = decodeUtf16(units, count, i);
    appendUtf8(out, decoded.codePoint);
    i += decoded.width;
  }
  return out;
}

void JsonWriter::beforeValue() {
  if (afterKey_) {
    afterKey_ = false;
    return;
  }
  if (!needComma_.empty()) {
    if (needComma_.back() != 0) *out_ += ',';
    needComma_.back() = 1;
  }
}

void JsonWriter::beginObject() {
  beforeValue();
  *out_ += '{';
  needComma_.push_back(0);
}
void JsonWriter::endObject() {
  *out_ += '}';
  needComma_.pop_back();
}
void JsonWriter::beginArray() {
  beforeValue();
  *out_ += '[';
  needComma_.push_back(0);
}
void JsonWriter::endArray() {
  *out_ += ']';
  needComma_.pop_back();
}

void JsonWriter::key(std::string_view name) {
  if (!needComma_.empty()) {
    if (needComma_.back() != 0) *out_ += ',';
    needComma_.back() = 1;
  }
  appendJsonString(*out_, name);
  *out_ += ':';
  afterKey_ = true;
}

void JsonWriter::str(std::string_view utf8) {
  beforeValue();
  appendJsonString(*out_, utf8);
}

void JsonWriter::num(double value) {
  beforeValue();
  if (!std::isfinite(value)) *out_ += "null";
  else *out_ += formatDouble(value);
}

void JsonWriter::integer(int64_t value) {
  beforeValue();
  *out_ += std::to_string(value);
}
void JsonWriter::boolean(bool value) {
  beforeValue();
  *out_ += value ? "true" : "false";
}
void JsonWriter::null() {
  beforeValue();
  *out_ += "null";
}
void JsonWriter::raw(std::string_view json) {
  beforeValue();
  out_->append(json.data(), json.size());
}

}

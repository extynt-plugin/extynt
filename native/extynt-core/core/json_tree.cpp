// The strict RFC 8259 parser behind json_tree.h. Offsets in error messages are byte positions in the source.
#include "json_tree.h"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <string>
#include <string_view>
#include <utility>

#include "utf8.h"

namespace extynt {

const JsonNode* JsonNode::find(std::string_view key) const {
  if (type != Type::Object) return nullptr;
  for (const auto& member : members) {
    if (member.first == key) return &member.second;
  }
  return nullptr;
}

namespace {

constexpr int kMaxDepth = 32;
constexpr std::string_view kEscapeKeys = "\"\\/bfnrt";
constexpr std::string_view kEscapeValues = "\"\\/\b\f\n\r\t";

class Parser {
 public:
  explicit Parser(std::string_view source) : s_(source) {}

  bool run(JsonNode& out, std::string& error) {
    skip();
    if (!value(out, 0)) {
      error = error_;
      return false;
    }
    skip();
    if (pos_ != s_.size()) {
      fail("trailing characters");
      error = error_;
      return false;
    }
    return true;
  }

 private:
  enum class Next : uint8_t { More, Done, Error };

  bool fail(const char* message) {
    if (error_.empty()) error_ = std::string(message) + " at offset " + std::to_string(pos_);
    return false;
  }
  void skip() {
    while (pos_ < s_.size() && (s_[pos_] == ' ' || s_[pos_] == '\t' || s_[pos_] == '\n' || s_[pos_] == '\r')) ++pos_;
  }
  bool literal(const char* word) {
    const size_t n = std::char_traits<char>::length(word);
    if (s_.compare(pos_, n, word) != 0) return fail("invalid literal");
    pos_ += n;
    return true;
  }
  bool value(JsonNode& out, int depth) {
    if (depth > kMaxDepth) return fail("nesting too deep");
    if (pos_ >= s_.size()) return fail("unexpected end");
    switch (s_[pos_]) {
      case '{': return object(out, depth);
      case '[': return array(out, depth);
      default: return scalar(out);
    }
  }
  bool scalar(JsonNode& out) {
    switch (s_[pos_]) {
      case '"': out.type = JsonNode::Type::String; return string(out.text);
      case 't':
        out.type = JsonNode::Type::Bool;
        out.boolean = true;
        return literal("true");
      case 'f':
        out.type = JsonNode::Type::Bool;
        out.boolean = false;
        return literal("false");
      case 'n': out.type = JsonNode::Type::Null; return literal("null");
      default: return number(out);
    }
  }
  [[nodiscard]] bool at(char c) const { return pos_ < s_.size() && s_[pos_] == c; }
  size_t skipDigits() {
    const size_t start = pos_;
    while (pos_ < s_.size() && s_[pos_] >= '0' && s_[pos_] <= '9') ++pos_;
    return pos_ - start;
  }
  bool requireDigits() { return skipDigits() != 0 || fail("invalid number"); }
  bool fraction() {
    if (!at('.')) return true;
    ++pos_;
    return requireDigits();
  }
  bool exponent() {
    if (!at('e') && !at('E')) return true;
    ++pos_;
    if (at('+') || at('-')) ++pos_;
    return requireDigits();
  }
  bool number(JsonNode& out) {
    const size_t start = pos_;
    if (at('-')) ++pos_;
    if (!requireDigits() || !fraction() || !exponent()) return false;
    const std::string text(s_.substr(start, pos_ - start));
    out.type = JsonNode::Type::Number;
    out.number = std::strtod(text.c_str(), nullptr);
    return std::isfinite(out.number) ? true : fail("number out of range");
  }
  static int hexValue(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
  }
  bool hex4(unsigned& code) {
    if (pos_ + 4 > s_.size()) return fail("bad \\u escape");
    code = 0;
    for (size_t i = 0; i < 4; ++i) {
      const int digit = hexValue(s_[pos_ + i]);
      if (digit < 0) return fail("bad \\u escape");
      code = (code << 4) | static_cast<unsigned>(digit);
    }
    pos_ += 4;
    return true;
  }
  unsigned joinSurrogates(unsigned high) {
    const size_t save = pos_;
    pos_ += 2;
    unsigned low = 0;
    if (hex4(low) && low >= 0xDC00 && low <= 0xDFFF) return 0x10000 + ((high - 0xD800) << 10) + (low - 0xDC00);
    pos_ = save;
    return 0xFFFD;
  }
  bool unicodeEscape(std::string& out) {
    unsigned code = 0;
    if (!hex4(code)) return false;
    if (code >= 0xD800 && code <= 0xDBFF && s_.substr(pos_, 2) == "\\u") code = joinSurrogates(code);
    else if (code >= 0xD800 && code <= 0xDFFF) code = 0xFFFD;
    appendUtf8(out, code);
    return true;
  }
  bool escape(std::string& out) {
    const char e = s_[pos_++];
    if (e == 'u') return unicodeEscape(out);
    const size_t index = kEscapeKeys.find(e);
    if (index == std::string_view::npos) return fail("bad escape");
    out += kEscapeValues[index];
    return true;
  }
  bool string(std::string& out) {
    out.clear();
    ++pos_;
    while (pos_ < s_.size()) {
      const auto c = static_cast<unsigned char>(s_[pos_++]);
      if (c == '"') return true;
      if (c < 0x20) return fail("control character in string");
      if (c != '\\') {
        out += static_cast<char>(c);
        continue;
      }
      if (pos_ >= s_.size()) break;
      if (!escape(out)) return false;
    }
    return fail("unterminated string");
  }
  Next afterElement(char close, const char* unterminated, const char* expected) {
    skip();
    if (pos_ >= s_.size()) {
      fail(unterminated);
      return Next::Error;
    }
    if (s_[pos_] == ',') {
      ++pos_;
      return Next::More;
    }
    if (s_[pos_] == close) {
      ++pos_;
      return Next::Done;
    }
    fail(expected);
    return Next::Error;
  }
  bool array(JsonNode& out, int depth) {
    out.type = JsonNode::Type::Array;
    ++pos_;
    skip();
    if (at(']')) {
      ++pos_;
      return true;
    }
    for (;;) {
      out.items.emplace_back();
      skip();
      if (!value(out.items.back(), depth + 1)) return false;
      const Next next = afterElement(']', "unterminated array", "expected , or ]");
      if (next != Next::More) return next == Next::Done;
    }
  }
  bool member(JsonNode& out, int depth) {
    skip();
    if (!at('"')) return fail("expected object key");
    std::string key;
    if (!string(key)) return false;
    skip();
    if (!at(':')) return fail("expected :");
    ++pos_;
    skip();
    out.members.emplace_back(std::move(key), JsonNode());
    return value(out.members.back().second, depth + 1);
  }
  bool object(JsonNode& out, int depth) {
    out.type = JsonNode::Type::Object;
    ++pos_;
    skip();
    if (at('}')) {
      ++pos_;
      return true;
    }
    for (;;) {
      if (!member(out, depth)) return false;
      const Next next = afterElement('}', "unterminated object", "expected , or }");
      if (next != Next::More) return next == Next::Done;
    }
  }

  std::string_view s_;
  size_t pos_ = 0;
  std::string error_;
};

}

bool parseJsonNode(std::string_view source, JsonNode& out, std::string& error) {
  Parser parser(source);
  return parser.run(out, error);
}

}

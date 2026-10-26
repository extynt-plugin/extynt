// The parsed form of a strict RFC 8259 document with a depth limit. Private to json_decode: only json_decode (and the
// tests' json_probe) read it; everything else gets typed values from json_decode.h.
#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace extynt {

struct JsonNode {
  enum class Type : uint8_t { Null, Bool, Number, String, Array, Object };

  Type type = Type::Null;
  bool boolean = false;
  double number = 0;
  std::string text;
  std::vector<JsonNode> items;
  std::vector<std::pair<std::string, JsonNode>> members;

  [[nodiscard]] bool isObject() const { return type == Type::Object; }
  [[nodiscard]] bool isArray() const { return type == Type::Array; }
  [[nodiscard]] bool isString() const { return type == Type::String; }
  [[nodiscard]] bool isNumber() const { return type == Type::Number; }
  [[nodiscard]] bool isBool() const { return type == Type::Bool; }
  [[nodiscard]] bool isNull() const { return type == Type::Null; }
  [[nodiscard]] const JsonNode* find(std::string_view key) const;
};

// Parses a whole document. On failure returns false and sets `error` (with the byte offset).
bool parseJsonNode(std::string_view source, JsonNode& out, std::string& error);

}

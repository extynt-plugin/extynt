// The only place protocol JSON is read. Text is parsed strictly (RFC 8259, depth-limited) and handed out as typed
// views; a reader returns nothing when a member is absent or has another type, so a caller decides what each case
// means.
#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>

namespace extynt {

struct JsonNode;
class JsonArray;

struct IntegerRange {
  int64_t min;
  int64_t max;
};

class JsonObject {
 public:
  explicit JsonObject(std::shared_ptr<const JsonNode> node) : node_(std::move(node)) {}

  [[nodiscard]] bool has(std::string_view key) const;
  [[nodiscard]] size_t memberCount() const;
  [[nodiscard]] std::optional<std::string> string(std::string_view key) const;
  [[nodiscard]] std::optional<bool> boolean(std::string_view key) const;
  [[nodiscard]] std::optional<double> number(std::string_view key) const;
  [[nodiscard]] std::optional<int64_t> integer(std::string_view key, const IntegerRange& range) const;
  [[nodiscard]] std::optional<JsonObject> object(std::string_view key) const;
  [[nodiscard]] std::optional<JsonArray> array(std::string_view key) const;

 private:
  std::shared_ptr<const JsonNode> node_;
};

class JsonArray {
 public:
  explicit JsonArray(std::shared_ptr<const JsonNode> node) : node_(std::move(node)) {}

  [[nodiscard]] size_t size() const;
  [[nodiscard]] std::optional<std::string> stringAt(size_t index) const;
  [[nodiscard]] std::optional<double> numberAt(size_t index) const;
  [[nodiscard]] std::optional<JsonObject> objectAt(size_t index) const;

 private:
  std::shared_ptr<const JsonNode> node_;
};

// The outcome of reading text that should be an object: `object` when it is one; otherwise `syntaxError` says why the
// text is not JSON, and is empty when it is valid JSON of another kind.
struct ObjectDocument {
  std::optional<JsonObject> object;
  std::string syntaxError;
};

[[nodiscard]] ObjectDocument readObjectDocument(std::string_view text);

}

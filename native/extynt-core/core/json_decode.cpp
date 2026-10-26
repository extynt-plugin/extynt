// Typed readers over the parsed document of json_tree.h; the views share ownership of the tree they point into.
#include "json_decode.h"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>

#include "json_tree.h"

namespace extynt {

namespace {

std::shared_ptr<const JsonNode> within(const std::shared_ptr<const JsonNode>& owner, const JsonNode& child) {
  return {owner, &child};
}

}

bool JsonObject::has(std::string_view key) const { return node_->find(key) != nullptr; }

size_t JsonObject::memberCount() const { return node_->members.size(); }

std::optional<std::string> JsonObject::string(std::string_view key) const {
  const JsonNode* member = node_->find(key);
  if (member == nullptr || !member->isString()) return std::nullopt;
  return member->text;
}

std::optional<bool> JsonObject::boolean(std::string_view key) const {
  const JsonNode* member = node_->find(key);
  if (member == nullptr || !member->isBool()) return std::nullopt;
  return member->boolean;
}

std::optional<double> JsonObject::number(std::string_view key) const {
  const JsonNode* member = node_->find(key);
  if (member == nullptr || !member->isNumber()) return std::nullopt;
  return member->number;
}

std::optional<int64_t> JsonObject::integer(std::string_view key, const IntegerRange& range) const {
  const std::optional<double> value = number(key);
  if (!value || *value != std::floor(*value) || *value < static_cast<double>(range.min) ||
      *value > static_cast<double>(range.max))
    return std::nullopt;
  return static_cast<int64_t>(*value);
}

std::optional<JsonObject> JsonObject::object(std::string_view key) const {
  const JsonNode* member = node_->find(key);
  if (member == nullptr || !member->isObject()) return std::nullopt;
  return JsonObject(within(node_, *member));
}

std::optional<JsonArray> JsonObject::array(std::string_view key) const {
  const JsonNode* member = node_->find(key);
  if (member == nullptr || !member->isArray()) return std::nullopt;
  return JsonArray(within(node_, *member));
}

size_t JsonArray::size() const { return node_->items.size(); }

std::optional<std::string> JsonArray::stringAt(size_t index) const {
  const JsonNode& item = node_->items.at(index);
  if (!item.isString()) return std::nullopt;
  return item.text;
}

std::optional<double> JsonArray::numberAt(size_t index) const {
  const JsonNode& item = node_->items.at(index);
  if (!item.isNumber()) return std::nullopt;
  return item.number;
}

std::optional<JsonObject> JsonArray::objectAt(size_t index) const {
  const JsonNode& item = node_->items.at(index);
  if (!item.isObject()) return std::nullopt;
  return JsonObject(within(node_, item));
}

ObjectDocument readObjectDocument(std::string_view text) {
  auto root = std::make_shared<JsonNode>();
  ObjectDocument document;
  if (!parseJsonNode(text, *root, document.syntaxError) || !root->isObject()) return document;
  document.object = JsonObject(std::move(root));
  return document;
}

}

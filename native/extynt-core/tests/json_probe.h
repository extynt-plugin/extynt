// Test-only view of the parsed JSON tree, so tests can inspect the responses they provoke member by member.
#pragma once

#include <string>
#include <string_view>

#include "json_tree.h"

namespace extynt {

using JsonValue = JsonNode;

inline bool parseJson(std::string_view source, JsonValue& out, std::string& error) {
  return parseJsonNode(source, out, error);
}

}

// Reads the sidecar's endpoint out of its session.json.
#include "session_port.h"

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

#include "json_decode.h"

namespace extynt {

namespace {

constexpr IntegerRange kPortRange{1, 65535};

}

std::optional<SessionEndpoint> sessionEndpointFromJson(std::string_view text) {
  const ObjectDocument document = readObjectDocument(text);
  if (!document.object) return std::nullopt;
  const std::optional<int64_t> port = document.object->integer("port", kPortRange);
  const std::optional<std::string> token = document.object->string("token");
  if (!port || !token || token->empty() || token->size() > kMaxSessionTokenLength) return std::nullopt;
  return SessionEndpoint{static_cast<int>(*port), *token};
}

}

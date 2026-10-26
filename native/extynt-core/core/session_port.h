// The sidecar's endpoint, from its per-user session.json ({"port": N, "token": "..."}). Pure core. The token is passed
// only into the page's user script (panelNativeInfoScript), never logged.
#pragma once

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>

namespace extynt {

struct SessionEndpoint {
  int port = 0;
  std::string token;
};

// The longest token accepted: the page refuses anything above 256 characters.
constexpr size_t kMaxSessionTokenLength = 256;

// The port (1..65535) and the bearer token (a non-empty string of at most kMaxSessionTokenLength bytes) of a
// session.json; nothing for anything else (missing, wrong type, malformed JSON).
std::optional<SessionEndpoint> sessionEndpointFromJson(std::string_view text);

}

// Pieces of request parsing shared by request.cpp and request_host.cpp. Private to the core.
#pragma once

#include <cstdint>
#include <optional>
#include <string>

#include "json_decode.h"
#include "request.h"

namespace extynt::detail {

struct Refusal {
  std::string code;
  std::string message;
};

[[nodiscard]] Refusal badRequest(std::string message);

// The refusal for an optional integer member that is present but not a whole number inside `range`.
[[nodiscard]] std::optional<Refusal> integerProblem(const JsonObject& root, const char* key, const IntegerRange& range);

// The refusal for host_call and watch members (entry, args, intervalMs, stillMs); nothing for any other op.
[[nodiscard]] std::optional<Refusal> readHostFields(const JsonObject& root, Request& req);

}

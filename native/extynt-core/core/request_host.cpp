// host_call and watch request members.
#include <optional>
#include <string>

#include "host_entries.h"
#include "json_decode.h"
#include "request.h"
#include "request_parts.h"

namespace extynt::detail {

namespace {

constexpr IntegerRange kWatchIntervalRange{kWatchIntervalMinMs, kWatchIntervalMaxMs};
constexpr IntegerRange kWatchStillRange{kWatchStillMinMs, kWatchStillMaxMs};

std::string argsProblem(const ObjectDocument& args) {
  const std::string reason = args.syntaxError.empty() ? "" : ": " + args.syntaxError;
  return "args must hold the JSON text of an object" + reason;
}

std::optional<Refusal> readHostCall(const JsonObject& root, Request& req) {
  const std::optional<std::string> entry = root.string("entry");
  if (!entry) return badRequest("host_call needs entry, a string");
  const std::optional<HostEntry> known = parseHostEntry(*entry);
  if (!known) return Refusal{"ENTRY_NOT_ALLOWED", "entry is not in the allowlist: " + *entry};
  const std::optional<std::string> args = root.string("args");
  if (!args) return badRequest("host_call needs args, a string holding the JSON text of an object");
  const ObjectDocument parsed = readObjectDocument(*args);
  if (!parsed.object) return badRequest(argsProblem(parsed));
  req.entry = *known;
  req.argsJson = *args;
  req.claimsEngine = *known == HostEntry::CatalogueProbePage && parsed.object->boolean("engine").value_or(false);
  return std::nullopt;
}

std::optional<Refusal> readWatch(const JsonObject& root, Request& req) {
  if (auto problem = integerProblem(root, "intervalMs", kWatchIntervalRange)) return problem;
  if (auto problem = integerProblem(root, "stillMs", kWatchStillRange)) return problem;
  req.watchIntervalMs =
      static_cast<int>(root.integer("intervalMs", kWatchIntervalRange).value_or(kWatchIntervalDefaultMs));
  req.watchStillMs = static_cast<int>(root.integer("stillMs", kWatchStillRange).value_or(kWatchStillDefaultMs));
  return std::nullopt;
}

}

std::optional<Refusal> readHostFields(const JsonObject& root, Request& req) {
  if (req.op == Op::HostCall) return readHostCall(root, req);
  if (req.op == Op::Watch) return readWatch(root, req);
  return std::nullopt;
}

}

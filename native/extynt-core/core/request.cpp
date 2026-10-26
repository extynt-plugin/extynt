// Decodes one protocol line into a Request: every member is read with its exact type and range, and anything else is a
// refusal with the protocol's error code and message.
#include "request.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "json_decode.h"
#include "json_writer.h"
#include "request_id.h"
#include "request_parts.h"

namespace extynt {

namespace {

using detail::badRequest;
using detail::integerProblem;
using detail::Refusal;

constexpr size_t kMaxDigitsIdLength = 15;
constexpr double kIdLimit = 9e15;
constexpr IntegerRange kMaxPropertiesRange{0, 1000000};
constexpr IntegerRange kMaxDepthRange{1, 64};
constexpr std::array<const char*, 4> kFlagKeys = {"preExpression", "hashes", "propertyHashes", "debugFlags"};

ParsedRequest refuse(const char* code, std::string message) {
  ParsedRequest out;
  out.errorCode = code;
  out.errorMessage = std::move(message);
  return out;
}

std::optional<std::string> idText(const JsonObject& object, const char* key) {
  if (std::optional<std::string> text = object.string(key)) return text->empty() ? std::nullopt : text;
  const std::optional<double> number = object.number(key);
  if (number && *number >= 0 && *number == std::floor(*number) && *number < kIdLimit) return formatDouble(*number);
  return std::nullopt;
}

std::optional<std::string> digitsId(const JsonObject& object, const char* key) {
  std::optional<std::string> id = idText(object, key);
  if (!id || id->size() > kMaxDigitsIdLength) return std::nullopt;
  const bool digits = std::all_of(id->begin(), id->end(), [](char c) { return c >= '0' && c <= '9'; });
  return digits ? id : std::nullopt;
}

std::optional<Op> opFromName(const std::string& name) {
  static constexpr std::array<std::pair<std::string_view, Op>, 14> kOps = {{
      {"ping", Op::Ping},
      {"ping_direct", Op::PingDirect},
      {"read_project", Op::ReadProject},
      {"read_comp", Op::ReadComp},
      {"read_paths", Op::ReadPaths},
      {"hash_project", Op::HashProject},
      {"revision", Op::Revision},
      {"batch", Op::Batch},
      {"apply_test", Op::ApplyTest},
      {"undo_test", Op::UndoTest},
      {"host_call", Op::HostCall},
      {"watch", Op::Watch},
      {"watch_state", Op::WatchState},
      {"effect_menus", Op::EffectMenus},
  }};
  for (const auto& entry : kOps) {
    if (entry.first == name) return entry.second;
  }
  return std::nullopt;
}

std::optional<PathTarget> readTarget(const std::optional<JsonObject>& item) {
  if (!item) return std::nullopt;
  std::optional<std::string> compId = idText(*item, "compId");
  std::optional<std::string> layerId = idText(*item, "layerId");
  std::optional<std::string> path = item->string("path");
  if (!compId || !layerId || !path || path->empty()) return std::nullopt;
  return PathTarget{std::move(*compId), std::move(*layerId), std::move(*path)};
}

std::optional<Refusal> readTargets(const JsonObject& root, Request& req) {
  const std::optional<JsonArray> list = root.array("targets");
  if (!list || list->size() == 0 || list->size() > kMaxTargets)
    return badRequest("targets must be an array of 1 to " + std::to_string(kMaxTargets) + " objects");
  for (size_t i = 0; i < list->size(); ++i) {
    std::optional<PathTarget> target = readTarget(list->objectAt(i));
    if (!target) return badRequest("each target needs compId, layerId and a non-empty path");
    req.targets.push_back(std::move(*target));
  }
  return std::nullopt;
}

std::optional<Refusal> readDetail(const JsonObject& root, Request& req) {
  req.detail = req.op == Op::ReadProject ? Detail::Structure : Detail::Full;
  if (!root.has("detail")) return std::nullopt;
  const std::optional<std::string> detail = root.string("detail");
  if (detail == "structure") req.detail = Detail::Structure;
  else if (detail == "full") req.detail = Detail::Full;
  else return badRequest(R"(detail must be "structure" or "full")");
  return std::nullopt;
}

std::optional<Refusal> flagProblem(const JsonObject& root) {
  for (const char* key : kFlagKeys) {
    if (root.has(key) && !root.boolean(key)) return badRequest(std::string(key) + " must be a boolean");
  }
  return std::nullopt;
}

std::optional<Refusal> readOptions(const JsonObject& root, Request& req) {
  if (auto problem = readDetail(root, req)) return problem;
  if (auto problem = integerProblem(root, "maxPropertiesPerLayer", kMaxPropertiesRange)) return problem;
  if (auto problem = integerProblem(root, "maxPropertyDepth", kMaxDepthRange)) return problem;
  if (auto problem = flagProblem(root)) return problem;
  req.maxPropertiesPerLayer = root.integer("maxPropertiesPerLayer", kMaxPropertiesRange).value_or(0);
  req.maxPropertyDepth =
      static_cast<int>(root.integer("maxPropertyDepth", kMaxDepthRange).value_or(req.maxPropertyDepth));
  req.preExpression = root.boolean("preExpression").value_or(false);
  req.hashes = root.boolean("hashes").value_or(false);
  req.propertyHashes = root.boolean("propertyHashes").value_or(false);
  req.debugFlags = root.boolean("debugFlags").value_or(false);
  return std::nullopt;
}

std::optional<Refusal> readApplyTest(const JsonObject& root, Request& req) {
  std::optional<std::string> compId = digitsId(root, "compId");
  std::optional<std::string> layerId = digitsId(root, "layerId");
  if (!compId || !layerId) return badRequest("apply_test needs integer compId and layerId");
  const std::optional<double> opacity = root.number("opacity");
  if (!opacity || *opacity < 0 || *opacity > 100) return badRequest("apply_test needs opacity, a number from 0 to 100");
  req.compId = std::move(*compId);
  req.layerId = std::move(*layerId);
  req.opacity = *opacity;
  req.hasLayerTarget = true;
  return std::nullopt;
}

std::optional<Refusal> readUndoTest(const JsonObject& root, Request& req) {
  if (!root.has("compId") && !root.has("layerId")) return std::nullopt;
  std::optional<std::string> compId = digitsId(root, "compId");
  std::optional<std::string> layerId = digitsId(root, "layerId");
  if (!compId || !layerId) return badRequest("undo_test takes either no target or integer compId and layerId together");
  req.compId = std::move(*compId);
  req.layerId = std::move(*layerId);
  req.hasLayerTarget = true;
  return std::nullopt;
}

ParsedRequest parseObject(const JsonObject& root, bool nested);

ParsedRequest parseBatchItem(const std::optional<JsonObject>& item) {
  return item ? parseObject(*item, true) : refuse("BAD_REQUEST", "request must be a JSON object");
}

std::optional<Refusal> readBatch(const JsonObject& root, Request& req) {
  const std::optional<JsonArray> list = root.array("ops");
  if (!list || list->size() == 0 || list->size() > kMaxBatchOps)
    return badRequest("ops must be an array of 1 to " + std::to_string(kMaxBatchOps) + " request objects");
  for (size_t i = 0; i < list->size(); ++i) {
    ParsedRequest inner = parseBatchItem(list->objectAt(i));
    if (!inner.ok) return Refusal{inner.errorCode, "ops[" + std::to_string(i) + "]: " + inner.errorMessage};
    req.batch.push_back(std::move(inner.request));
  }
  if (root.has("stopOnError") && !root.boolean("stopOnError")) return badRequest("stopOnError must be a boolean");
  req.stopOnError = root.boolean("stopOnError").value_or(false);
  return std::nullopt;
}

void readIdentity(const JsonObject& root, bool nested, Request& req) {
  if (const std::optional<std::string> id = root.string("id")) req.id = *id;
  else if (const std::optional<double> number = root.number("id")) req.id = formatDouble(*number);
  if (nested) return;
  req.token = root.string("token").value_or("");
}

std::optional<Refusal> nestedRefusal(Op op) {
  switch (op) {
    case Op::Batch: return badRequest("batch cannot be nested");
    case Op::PingDirect: return badRequest("ping_direct cannot run in a batch (it is answered on the socket thread)");
    case Op::Watch: return badRequest("watch cannot run in a batch (it turns the connection into an event stream)");
    default: return std::nullopt;
  }
}

std::optional<Refusal> readEnvelope(const JsonObject& root, bool nested, Request& req) {
  readIdentity(root, nested, req);
  const std::optional<std::string> opName = root.string("op");
  if (!opName) return badRequest("op must be a string");
  req.opName = *opName;
  const std::optional<Op> op = opFromName(req.opName);
  if (!op) return Refusal{"UNKNOWN_OP", "unknown op: " + req.opName};
  req.op = *op;
  return nested ? nestedRefusal(req.op) : std::nullopt;
}

std::optional<Refusal> readReadFields(const JsonObject& root, Request& req) {
  if (req.op == Op::ReadComp) {
    std::optional<std::string> compId = idText(root, "compId");
    if (!compId) return badRequest("read_comp needs compId");
    req.compId = std::move(*compId);
  }
  if (req.op == Op::EffectMenus) {
    std::optional<std::string> compId = idText(root, "compId");
    std::optional<std::string> layerId = idText(root, "layerId");
    if (!compId || !layerId) return badRequest("effect_menus needs compId and layerId");
    req.compId = std::move(*compId);
    req.layerId = std::move(*layerId);
  }
  return req.op == Op::ReadPaths ? readTargets(root, req) : std::nullopt;
}

std::optional<Refusal> readWriteFields(const JsonObject& root, Request& req) {
  switch (req.op) {
    case Op::ApplyTest: return readApplyTest(root, req);
    case Op::UndoTest: return readUndoTest(root, req);
    case Op::Batch: return readBatch(root, req);
    default: return std::nullopt;
  }
}

std::optional<Refusal> readBody(const JsonObject& root, Request& req) {
  using Reader = std::optional<Refusal> (*)(const JsonObject&, Request&);
  static constexpr std::array<Reader, 4> kReaders = {readOptions, readReadFields, readWriteFields,
                                                     detail::readHostFields};
  for (const Reader reader : kReaders) {
    if (auto refusal = reader(root, req)) return refusal;
  }
  return std::nullopt;
}

ParsedRequest parseObject(const JsonObject& root, bool nested) {
  ParsedRequest out;
  std::optional<Refusal> refusal = readEnvelope(root, nested, out.request);
  if (!refusal) refusal = readBody(root, out.request);
  if (refusal) {
    out.errorCode = std::move(refusal->code);
    out.errorMessage = std::move(refusal->message);
    return out;
  }
  out.ok = true;
  return out;
}

}

namespace detail {

Refusal badRequest(std::string message) { return Refusal{"BAD_REQUEST", std::move(message)}; }

std::optional<Refusal> integerProblem(const JsonObject& root, const char* key, const IntegerRange& range) {
  if (!root.has(key) || root.integer(key, range)) return std::nullopt;
  return badRequest(std::string(key) + " must be an integer from " + std::to_string(range.min) + " to " +
                    std::to_string(range.max));
}

}

ParsedRequest parseRequest(std::string_view line) {
  if (line.size() > kMaxRequestBytes) {
    ParsedRequest tooLarge = refuse("REQUEST_TOO_LARGE", "request exceeds 16 MiB");
    tooLarge.request.id = recoverRequestId(line);
    return tooLarge;
  }
  const ObjectDocument document = readObjectDocument(line);
  if (!document.object) {
    return document.syntaxError.empty() ? refuse("BAD_REQUEST", "request must be a JSON object")
                                        : refuse("BAD_JSON", document.syntaxError);
  }
  return parseObject(*document.object, false);
}

}

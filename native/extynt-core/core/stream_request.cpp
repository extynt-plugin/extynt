// Decodes the stream bridge's request.json into the structs of stream_request.h.
#include "stream_request.h"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "json_decode.h"

namespace extynt {

namespace {

constexpr IntegerRange kIdRange{0, 2147483647};

PathSegment decodeSegment(const std::optional<JsonObject>& segment) {
  if (!segment) return UnusableSegment{};
  const bool exclusive = segment->memberCount() == 1;
  if (std::optional<std::string> name = segment->string("match")) return MatchSegment{std::move(*name), exclusive};
  if (const std::optional<int64_t> index = segment->integer("index", kIdRange)) {
    return IndexSegment{static_cast<uint32_t>(*index), exclusive};
  }
  return UnusableSegment{};
}

std::optional<std::vector<PathSegment>> decodePath(const JsonObject& op) {
  const std::optional<JsonArray> path = op.array("path");
  if (!path || path->size() == 0 || path->size() > kBridgeMaxPathDepth) return std::nullopt;
  std::vector<PathSegment> segments;
  segments.reserve(path->size());
  for (size_t i = 0; i < path->size(); ++i) segments.push_back(decodeSegment(path->objectAt(i)));
  return segments;
}

std::vector<double> decodeNumbers(const JsonObject& op) {
  if (const std::optional<double> single = op.number("value")) return {*single};
  std::vector<double> numbers;
  const std::optional<JsonArray> list = op.array("value");
  if (!list) return numbers;
  numbers.reserve(list->size());
  for (size_t i = 0; i < list->size(); ++i) numbers.push_back(list->numberAt(i).value_or(std::nan("")));
  return numbers;
}

StreamOp decodeOp(const std::optional<JsonObject>& op) {
  StreamOp decoded;
  if (!op) return decoded;
  decoded.verb = op->string("op").value_or("");
  decoded.path = decodePath(*op);
  if (op->has("value")) decoded.value = decodeNumbers(*op);
  return decoded;
}

std::optional<int32_t> decodeId(const JsonObject& request, const char* key) {
  const std::optional<int64_t> id = request.integer(key, kIdRange);
  if (!id) return std::nullopt;
  return static_cast<int32_t>(*id);
}

}

std::optional<StreamRequest> decodeStreamRequest(std::string_view text, std::string& problem) {
  const ObjectDocument document = readObjectDocument(text);
  if (!document.object) {
    problem = document.syntaxError;
    return std::nullopt;
  }
  StreamRequest request;
  request.token = document.object->string("token").value_or("");
  request.compId = decodeId(*document.object, "compId");
  request.layerId = decodeId(*document.object, "layerId");
  const std::optional<JsonArray> ops = document.object->array("ops");
  for (size_t i = 0; ops && i < ops->size() && i < kBridgeMaxOps; ++i) {
    request.ops.push_back(decodeOp(ops->objectAt(i)));
  }
  return request;
}

}

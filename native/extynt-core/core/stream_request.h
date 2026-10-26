// The stream bridge's request.json, decoded once into exact structs (ae/ae_stream_bridge.cpp acts on them, and
// stream_policy.h decides what they may touch). A member that is absent or of the wrong type decodes to its empty form,
// so each later check refuses it with its own message.
#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

namespace extynt {

constexpr size_t kBridgeMaxPathDepth = 12;
constexpr size_t kBridgeMaxOps = 256;

// A path segment that names a stream by its match name. `exclusive` is true when it is the segment's only member.
struct MatchSegment {
  std::string name;
  bool exclusive = false;
};

// A path segment that names a stream by its zero-based index (a whole number up to INT32_MAX). `exclusive` is true when
// it is the segment's only member.
struct IndexSegment {
  uint32_t index = 0;
  bool exclusive = false;
};

// A path segment that carries neither a string "match" nor an "index" that is a whole number in range.
struct UnusableSegment {};

using PathSegment = std::variant<MatchSegment, IndexSegment, UnusableSegment>;

// One operation: its verb, its path (nothing unless 1 to kBridgeMaxPathDepth segments) and, for a set, the numbers of
// its value (nothing when no value was given; empty when the value is neither a number nor an array).
struct StreamOp {
  std::string verb;
  std::optional<std::vector<PathSegment>> path;
  std::optional<std::vector<double>> value;
};

// The request: its token, the composition and layer ids (nothing unless a whole number from 0 to 2147483647) and its
// first kBridgeMaxOps operations.
struct StreamRequest {
  std::string token;
  std::optional<int32_t> compId;
  std::optional<int32_t> layerId;
  std::vector<StreamOp> ops;
};

// The request in `text`, or nothing with `problem` saying why it is not a JSON object.
[[nodiscard]] std::optional<StreamRequest> decodeStreamRequest(std::string_view text, std::string& problem);

}

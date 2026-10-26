// What the stream bridge (ae/ae_stream_bridge.cpp) lets a request do. Pure core, no SDK: the bridge is a local IPC
// surface into After Effects, and every decision about what a request may touch lives here so it is unit-tested on
// Linux. A `set` reaches only the two hidden streams of a Puppet pin; the token is a single-use nonce, not a secret.
#pragma once

#include <cstddef>
#include <deque>
#include <set>
#include <string>
#include <string_view>
#include <vector>

#include "stream_request.h"

namespace extynt {

constexpr size_t kBridgeMaxRequestBytes = size_t{1} << 20;
constexpr size_t kBridgeMaxTokens = 4096;

constexpr const char* kPuppetEffectMatch = "ADBE FreePin3";
constexpr const char* kPinOffsetMatch = "ADBE FreePin3 PosPin Vtx Offset";
constexpr const char* kPinIndexMatch = "ADBE FreePin3 PosPin Vtx Index";

// The leaf match name when `path` is exactly [Effect Parade, i, ARAP Group, Mesh Group, i, PosPins, i, leaf] with the
// leaf the pin's Vertex Offset or Vertex Index; "" for any other path. Every segment must carry exactly one key
// (match or index), so a segment cannot say one thing to this check and another to the stream lookup.
[[nodiscard]] std::string settablePinStream(const std::vector<PathSegment>& path);

// `numbers` are finite and at most 1e6 in magnitude; a vertex index must also be a whole number or 4294967295 (the
// "detached" marker).
[[nodiscard]] bool settableValuesInRange(const std::vector<double>& numbers, bool vertexIndex);

// 16 to 64 letters, digits, dots, dashes or underscores.
[[nodiscard]] bool validBridgeToken(std::string_view token);

// The tokens already used: each is good once, and the oldest is forgotten after kBridgeMaxTokens newer ones. Not
// thread-safe (main thread only).
class TokenLedger {
 public:
  // True the first time `token` is claimed, false for a repeat.
  [[nodiscard]] bool claim(const std::string& token);

 private:
  std::set<std::string> used_;
  std::deque<std::string> order_;
};

}

// The stream bridge's policy: which paths a set may reach, the bounds on set values, and single-use tokens.
#include "stream_policy.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

#include "stream_request.h"

namespace extynt {

namespace {

constexpr double kMaxMagnitude = 1.0e6;
constexpr double kDetachedVertex = 4294967295.0;
constexpr uint32_t kMaxSegmentIndex = 100000;
constexpr size_t kMinTokenChars = 16;
constexpr size_t kMaxTokenChars = 64;
constexpr size_t kPinPathSegments = 8;

bool isMatch(const PathSegment& segment, std::string_view name) {
  const auto* match = std::get_if<MatchSegment>(&segment);
  return match != nullptr && match->exclusive && match->name == name;
}

bool isIndex(const PathSegment& segment) {
  const auto* position = std::get_if<IndexSegment>(&segment);
  return position != nullptr && position->exclusive && position->index < kMaxSegmentIndex;
}

constexpr std::array<std::optional<std::string_view>, 7> kPinPrefix = {
    "ADBE Effect Parade",    std::nullopt, "ADBE FreePin3 ARAP Group", "ADBE FreePin3 Mesh Group", std::nullopt,
    "ADBE FreePin3 PosPins", std::nullopt};

bool pinPrefixMatches(const std::vector<PathSegment>& segments) {
  for (size_t i = 0; i < kPinPrefix.size(); ++i) {
    const std::optional<std::string_view>& name = kPinPrefix.at(i);
    const bool ok = name ? isMatch(segments.at(i), *name) : isIndex(segments.at(i));
    if (!ok) return false;
  }
  return true;
}

bool numberInRange(double n, bool vertexIndex) {
  if (!std::isfinite(n)) return false;
  if (!vertexIndex) return std::fabs(n) <= kMaxMagnitude;
  return n == kDetachedVertex || (n >= 0 && n <= kMaxMagnitude && n == std::floor(n));
}

bool tokenChar(char c) { return std::isalnum(static_cast<unsigned char>(c)) != 0 || c == '-' || c == '_' || c == '.'; }

}

std::string settablePinStream(const std::vector<PathSegment>& path) {
  if (path.size() != kPinPathSegments || !pinPrefixMatches(path)) return "";
  const PathSegment& leaf = path.at(kPinPrefix.size());
  if (isMatch(leaf, kPinOffsetMatch)) return kPinOffsetMatch;
  if (isMatch(leaf, kPinIndexMatch)) return kPinIndexMatch;
  return "";
}

bool settableValuesInRange(const std::vector<double>& numbers, bool vertexIndex) {
  return std::all_of(numbers.begin(), numbers.end(), [vertexIndex](double n) { return numberInRange(n, vertexIndex); });
}

bool validBridgeToken(std::string_view token) {
  if (token.size() < kMinTokenChars || token.size() > kMaxTokenChars) return false;
  return std::all_of(token.begin(), token.end(), tokenChar);
}

bool TokenLedger::claim(const std::string& token) {
  if (!used_.insert(token).second) return false;
  order_.push_back(token);
  if (order_.size() > kBridgeMaxTokens) {
    used_.erase(order_.front());
    order_.pop_front();
  }
  return true;
}

}

// Property path segments, encoded exactly as apps/panel/host/probe.jsx does:
//   encodePathSegment: % -> %25, / -> %2F, # -> %23 (in that order)
//   repeated siblings: the first keeps its text, later ones get "#n" (n = 2, 3, ...)
//   a segment is the property's matchName, or its display name when the matchName is empty
//   the layer root lists the Transform group first; every other group keeps host order
#pragma once

#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace extynt {

std::string encodePathSegment(std::string_view segment);
std::string decodePathSegment(std::string_view encoded);

inline constexpr const char* kTransformGroupMatchName = "ADBE Transform Group";
inline constexpr const char* kEffectParadeMatchName = "ADBE Effect Parade";
inline constexpr const char* kLayerStylesMatchName = "ADBE Layer Styles";

// Per-group de-duplication of sibling segments. One instance per group visit.
class SiblingSegments {
 public:
  // `matchName` and `displayName` are the raw (unencoded) strings.
  std::string next(std::string_view matchName, std::string_view displayName);

 private:
  std::unordered_map<std::string, int> seen_;
};

// Indices (0-based) in visit order for a layer root: Transform group first, others in host order.
// The text a segment is built from: the matchName, else the display name, else "unknown".
std::string_view segmentSource(std::string_view matchName, std::string_view displayName);

std::vector<size_t> rootVisitOrder(const std::vector<std::string>& matchNames);

struct PathSegment {
  // Segment text without the "#n" suffix, still encoded
  std::string encodedBase;
  // 1 for the first sibling with this text
  int occurrence = 1;
};

// Splits "A/B#2/C" into segments. Returns false for an empty path or an empty segment.
bool parsePath(std::string_view path, std::vector<PathSegment>& out);

}

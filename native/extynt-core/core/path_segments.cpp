// Encodes property path segments and numbers repeated siblings the way apps/panel/host/probe.jsx does.

#include "path_segments.h"
#include <string>
#include <string_view>
#include <cstddef>
#include <vector>
#include <utility>

namespace extynt {

std::string encodePathSegment(std::string_view segment) {
  std::string out;
  out.reserve(segment.size());
  for (const char c : segment) {
    if (c == '%') out += "%25";
    else if (c == '/') out += "%2F";
    else if (c == '#') out += "%23";
    else out += c;
  }
  return out;
}

std::string decodePathSegment(std::string_view encoded) {
  std::string out;
  out.reserve(encoded.size());
  for (size_t i = 0; i < encoded.size(); ++i) {
    if (encoded[i] == '%' && i + 2 < encoded.size()) {
      const std::string_view code = encoded.substr(i + 1, 2);
      if (code == "25") {
        out += '%';
        i += 2;
        continue;
      }
      if (code == "2F") {
        out += '/';
        i += 2;
        continue;
      }
      if (code == "23") {
        out += '#';
        i += 2;
        continue;
      }
    }
    out += encoded[i];
  }
  return out;
}

std::string_view segmentSource(std::string_view matchName, std::string_view displayName) {
  if (!matchName.empty()) return matchName;
  return displayName.empty() ? std::string_view("unknown") : displayName;
}

std::string SiblingSegments::next(std::string_view matchName, std::string_view displayName) {
  std::string segment = encodePathSegment(segmentSource(matchName, displayName));
  int& count = seen_["k:" + segment];
  count += 1;
  if (count > 1) segment += "#" + std::to_string(count);
  return segment;
}

std::vector<size_t> rootVisitOrder(const std::vector<std::string>& matchNames) {
  std::vector<size_t> order;
  order.reserve(matchNames.size());
  for (size_t i = 0; i < matchNames.size(); ++i) {
    if (matchNames[i] == kTransformGroupMatchName) order.insert(order.begin(), i);
    else order.push_back(i);
  }
  return order;
}

namespace {

constexpr int kMaxOccurrence = 100000000;

bool parseSegment(std::string_view part, PathSegment& segment) {
  const size_t hash = part.rfind('#');
  if (hash == std::string_view::npos) {
    segment.encodedBase = std::string(part);
    return true;
  }
  if (hash + 1 >= part.size()) return false;
  int n = 0;
  for (size_t i = hash + 1; i < part.size(); ++i) {
    if (part[i] < '0' || part[i] > '9' || n > kMaxOccurrence) return false;
    n = (n * 10) + (part[i] - '0');
  }
  if (n < 2) return false;
  segment.occurrence = n;
  segment.encodedBase = std::string(part.substr(0, hash));
  return true;
}

}

bool parsePath(std::string_view path, std::vector<PathSegment>& out) {
  out.clear();
  if (path.empty()) return false;
  size_t start = 0;
  while (start <= path.size()) {
    const size_t slash = path.find('/', start);
    const std::string_view part =
        path.substr(start, slash == std::string_view::npos ? std::string_view::npos : slash - start);
    PathSegment segment;
    if (part.empty() || !parseSegment(part, segment)) return false;
    out.push_back(std::move(segment));
    if (slash == std::string_view::npos) break;
    start = slash + 1;
  }
  return true;
}

}

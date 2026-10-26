// Parses a navigation target into scheme and origin, decides whether the panel may follow it and how a failed load
// reads.

#include "panel_nav.h"

#include <cstddef>
#include <cstdint>
#include <string>

namespace extynt::ae {

namespace {

constexpr long kUrlErrorCancelled = -999;
constexpr long kWebKitFrameLoadInterrupted = 102;
constexpr long kMaxPort = 65535;
const char* const kSidecarOriginPrefix = "http://127.0.0.1:";

struct ParsedUrl {
  bool valid = false;
  std::string scheme;
  std::string origin;
  std::string path;
};

std::string lowered(std::string text) {
  for (char& c : text) {
    if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
  }
  return text;
}

bool isAsciiLetter(char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }

bool isAsciiDigit(char c) { return c >= '0' && c <= '9'; }

bool isSchemeChar(char c, bool first) {
  return isAsciiLetter(c) || (!first && (isAsciiDigit(c) || c == '+' || c == '-' || c == '.'));
}

std::string schemeOf(const std::string& url) {
  const std::size_t colon = url.find(':');
  if (colon == std::string::npos || colon == 0) return "";
  for (std::size_t i = 0; i < colon; ++i) {
    if (!isSchemeChar(url[i], i == 0)) return "";
  }
  return lowered(url.substr(0, colon));
}

ParsedUrl parseUrl(const std::string& url) {
  ParsedUrl parsed;
  parsed.scheme = schemeOf(url);
  if (parsed.scheme.empty()) return parsed;
  parsed.valid = true;
  const std::string rest = url.substr(parsed.scheme.size() + 1);
  if (rest.compare(0, 2, "//") != 0) {
    parsed.path = rest;
    return parsed;
  }
  const std::size_t end = rest.find_first_of("/?#", 2);
  const std::string authority = rest.substr(2, end == std::string::npos ? std::string::npos : end - 2);
  parsed.origin = parsed.scheme + "://" + lowered(authority);
  if (end == std::string::npos || rest[end] != '/') {
    parsed.path = "/";
    return parsed;
  }
  const std::size_t stop = rest.find_first_of("?#", end);
  parsed.path = rest.substr(end, stop == std::string::npos ? std::string::npos : stop - end);
  return parsed;
}

bool hasParentSegment(const std::string& path) {
  std::size_t start = 0;
  while (start <= path.size()) {
    const std::size_t slash = path.find('/', start);
    const std::size_t stop = slash == std::string::npos ? path.size() : slash;
    if (path.compare(start, stop - start, "..") == 0) return true;
    start = stop + 1;
  }
  return false;
}

bool pathIsUnderUi(const std::string& path) {
  if (path.compare(0, 4, "/ui/") != 0) return false;
  const std::string lower = lowered(path);
  if (lower.find("%2e") != std::string::npos || lower.find("%2f") != std::string::npos ||
      lower.find("%5c") != std::string::npos || lower.find('\\') != std::string::npos)
    return false;
  return !hasParentSegment(path);
}

bool inScope(const NavigationScope& scope, const ParsedUrl& url) {
  if (scope.origin.empty() || url.origin != lowered(scope.origin)) return false;
  return scope.anyPath || pathIsUnderUi(url.path);
}

}

NavigationAction decideNavigation(const NavigationScope& scope, const NavigationRequest& request) {
  if (lowered(request.url) == "about:blank") return NavigationAction::Allow;
  const ParsedUrl url = parseUrl(request.url);
  if (!url.valid) return NavigationAction::Cancel;
  if (inScope(scope, url)) return NavigationAction::Allow;
  const bool web = url.scheme == "http" || url.scheme == "https";
  return web && request.linkActivated ? NavigationAction::OpenExternal : NavigationAction::Cancel;
}

std::string originOfUrl(const std::string& url) { return parseUrl(url).origin; }

bool developmentOverrideAllowed(bool developmentBuild, const std::string& url) {
  const std::string scheme = schemeOf(url);
  return developmentBuild && (scheme == "http" || scheme == "https");
}

bool failureShowsOfflinePage(const std::string& errorDomain, long errorCode) {
  if (errorDomain == "NSURLErrorDomain") return errorCode != kUrlErrorCancelled;
  return errorDomain == "WebKitErrorDomain" && errorCode != kWebKitFrameLoadInterrupted;
}

bool finishedBlankShowsOfflinePage(const std::string& finishedUrl, bool offlinePageShowing) {
  return !offlinePageShowing && (finishedUrl.empty() || finishedUrl == "about:blank");
}

bool loadWatchdogShowsOffline(std::uint64_t ticket, std::uint64_t latestTicket, bool settled) {
  return !settled && ticket == latestTicket;
}

bool webErrorShowsOfflinePage(int status) {
  constexpr int kServerUnreachable = 6;
  constexpr int kHostNameNotResolved = 13;
  constexpr int kUnexpectedError = 16;
  return (status >= kServerUnreachable && status <= kHostNameNotResolved) || status == kUnexpectedError;
}

bool pageOriginIsStale(const std::string& pageOrigin, int sessionPort) {
  const std::string prefix = kSidecarOriginPrefix;
  if (pageOrigin.compare(0, prefix.size(), prefix) != 0 || pageOrigin.size() == prefix.size()) return false;
  long port = 0;
  for (std::size_t i = prefix.size(); i < pageOrigin.size(); ++i) {
    if (pageOrigin[i] < '0' || pageOrigin[i] > '9') return false;
    port = (port * 10) + (pageOrigin[i] - '0');
    if (port > kMaxPort) return false;
  }
  return port != sessionPort;
}

}

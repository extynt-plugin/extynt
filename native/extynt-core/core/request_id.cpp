// Best-effort recovery of a request id from the head of a message that did not parse, by a small scan that accepts only
// a plain string or plain integer under the top-level "id" key.
#include "request_id.h"

#include <cctype>
#include <cstddef>
#include <string>
#include <string_view>

namespace extynt {

namespace {

bool isSpace(char c) { return std::isspace(static_cast<unsigned char>(c)) != 0; }

size_t skipSpace(std::string_view text, size_t at) {
  while (at < text.size() && isSpace(text[at])) ++at;
  return at;
}

size_t stringEnd(std::string_view text, size_t open) {
  for (size_t i = open + 1; i < text.size(); ++i) {
    if (text[i] == '\\') ++i;
    else if (text[i] == '"') return i;
  }
  return std::string_view::npos;
}

std::string plainString(std::string_view text, size_t open) {
  const size_t close = stringEnd(text, open);
  if (close == std::string_view::npos) return "";
  const std::string_view inner = text.substr(open + 1, close - open - 1);
  return inner.find('\\') == std::string_view::npos ? std::string(inner) : "";
}

size_t digitsEnd(std::string_view text, size_t at) {
  while (at < text.size() && std::isdigit(static_cast<unsigned char>(text[at])) != 0) ++at;
  return at;
}

bool endsValue(std::string_view text, size_t at) {
  return at < text.size() && (text[at] == ',' || text[at] == '}' || isSpace(text[at]));
}

std::string plainInteger(std::string_view text, size_t at) {
  const size_t end = digitsEnd(text, at);
  const bool leadingZero = end - at > 1 && text[at] == '0';
  return end > at && endsValue(text, end) && !leadingZero ? std::string(text.substr(at, end - at)) : "";
}

std::string valueAfterKey(std::string_view text, size_t keyEnd) {
  const size_t colon = skipSpace(text, keyEnd + 1);
  if (colon >= text.size() || text[colon] != ':') return "";
  const size_t at = skipSpace(text, colon + 1);
  if (at >= text.size()) return "";
  return text[at] == '"' ? plainString(text, at) : plainInteger(text, at);
}

int depthChange(char c) {
  if (c == '{' || c == '[') return 1;
  return (c == '}' || c == ']') ? -1 : 0;
}

std::string idOfKey(std::string_view head, size_t open, size_t close) {
  if (head.substr(open + 1, close - open - 1) != "id") return "";
  const std::string id = valueAfterKey(head, close);
  return id.size() <= kRequestIdMaxLength ? id : "";
}

}

std::string recoverRequestId(std::string_view head) {
  head = head.substr(0, kRequestIdScanBytes);
  int depth = 0;
  for (size_t i = 0; i < head.size(); ++i) {
    depth += depthChange(head[i]);
    if (head[i] != '"') continue;
    const size_t close = stringEnd(head, i);
    if (close == std::string_view::npos) return "";
    const std::string id = depth == 1 ? idOfKey(head, i, close) : "";
    if (!id.empty()) return id;
    i = close;
  }
  return "";
}

}

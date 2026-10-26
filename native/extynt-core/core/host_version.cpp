// Parses the host's version text, classifies it against the supported range and writes the `host` field of ping.

#include "host_version.h"

#include <cctype>
#include <cstddef>
#include <string>

#include "json_writer.h"

namespace extynt {

namespace {

constexpr int kFloorMajor = 25;
constexpr int kNewestMeasuredMajor = 26;
constexpr bool kAe25Measured = false;
constexpr int kNativeSvgMinMajor = 26;
constexpr int kRevisionGuardMinMajor = 25;
constexpr int kDigitBase = 10;
constexpr int kMaxComponent = 100000;

bool isDigit(char c) { return std::isdigit(static_cast<unsigned char>(c)) != 0; }

bool readNumber(const std::string& text, std::size_t& pos, int& out) {
  if (pos >= text.size() || !isDigit(text[pos])) return false;
  int value = 0;
  while (pos < text.size() && isDigit(text[pos])) {
    if (value < kMaxComponent) value = (value * kDigitBase) + (text[pos] - '0');
    ++pos;
  }
  out = value;
  return true;
}

bool isBuildChar(char c) { return std::isalnum(static_cast<unsigned char>(c)) != 0 || c == '.'; }

std::string takeBuild(const std::string& text, std::size_t& pos) {
  std::string build;
  for (; pos < text.size() && isBuildChar(text[pos]); ++pos) build += text[pos];
  return build;
}

std::string buildOf(const std::string& text, std::size_t pos) {
  if (pos < text.size() && text[pos] == 'x') {
    ++pos;
    return takeBuild(text, pos);
  }
  const std::size_t open = text.find('(', pos);
  if (open == std::string::npos || text.compare(open, 7, "(build ") != 0) return "";
  pos = open + 7;
  const std::string build = takeBuild(text, pos);
  return pos < text.size() && text[pos] == ')' ? build : "";
}

bool readPatch(const std::string& text, std::size_t& pos, int& patch) {
  if (pos >= text.size() || text[pos] != '.') return true;
  ++pos;
  return readNumber(text, pos, patch);
}

bool endsVersion(const std::string& text, std::size_t pos) {
  return pos >= text.size() || std::isspace(static_cast<unsigned char>(text[pos])) != 0 || text[pos] == 'x' ||
         text[pos] == '(';
}

bool readVersionNumbers(const std::string& text, std::size_t& pos, HostVersion& version) {
  if (!readNumber(text, pos, version.major) || pos >= text.size() || text[pos] != '.') return false;
  ++pos;
  return readNumber(text, pos, version.minor) && readPatch(text, pos, version.patch) && endsVersion(text, pos);
}

}

HostVersion parseHostVersion(const std::string& text) {
  HostVersion version;
  std::size_t pos = 0;
  while (pos < text.size() && std::isspace(static_cast<unsigned char>(text[pos])) != 0) ++pos;
  if (!readVersionNumbers(text, pos, version)) return {};
  version.known = true;
  version.build = buildOf(text, pos);
  return version;
}

HostFamily hostFamily(const HostVersion& version) {
  if (!version.known) return HostFamily::Unknown;
  if (version.major < kFloorMajor) return HostFamily::Older;
  if (version.major == kFloorMajor) return HostFamily::Ae25;
  if (version.major == kNewestMeasuredMajor) return HostFamily::Ae26;
  return HostFamily::Newer;
}

const char* hostFamilyName(HostFamily family) {
  switch (family) {
    case HostFamily::Older: return "older";
    case HostFamily::Ae25: return "ae25";
    case HostFamily::Ae26: return "ae26";
    case HostFamily::Newer: return "newer";
    case HostFamily::Unknown: break;
  }
  return "unknown";
}

const char* svgImportRoute(const HostVersion& version) {
  if (!version.known) return "unknown";
  return version.major >= kNativeSvgMinMajor ? "native" : "converter";
}

bool hostMajorMeasured(int major) { return major == kNewestMeasuredMajor || (kAe25Measured && major == kFloorMajor); }

bool hostExperimental(const HostVersion& version) { return hostFamily(version) == HostFamily::Newer; }

bool revisionGuardOn(const HostVersion& version) { return !version.known || version.major >= kRevisionGuardMinMajor; }

namespace {

void writeCapabilities(JsonWriter& w, const HostVersion& version, const HostApiFacts& facts) {
  w.key("capabilities");
  w.beginObject();
  w.field("svgImport", svgImportRoute(version));
  w.field("expressionText", facts.expressionUtf16 ? "utf16" : "utf8");
  w.fieldBool("suitesComplete", facts.suitesComplete);
  w.fieldInt("streamSuite", facts.streamSuite);
  w.field("revisionGuard", revisionGuardOn(version) ? "on" : "off");
  w.endObject();
}

}

std::string hostProfileJson(const std::string& versionText, const HostApiFacts& facts) {
  const HostVersion version = parseHostVersion(versionText);
  const HostFamily family = hostFamily(version);
  std::string text;
  JsonWriter w(text);
  w.beginObject();
  w.field("version", versionText);
  if (version.known) {
    w.fieldInt("major", version.major);
    w.fieldInt("minor", version.minor);
    w.fieldInt("patch", version.patch);
  } else {
    w.fieldNull("major");
    w.fieldNull("minor");
    w.fieldNull("patch");
  }
  if (version.build.empty()) w.fieldNull("build");
  else w.field("build", version.build);
  w.field("family", hostFamilyName(family));
  w.fieldBool("supported", family != HostFamily::Older);
  w.fieldBool("measured", version.known && hostMajorMeasured(version.major));
  w.fieldBool("experimental", hostExperimental(version));
  w.field("aegpApi", std::to_string(facts.aegpApiMajor) + "." + std::to_string(facts.aegpApiMinor));
  writeCapabilities(w, version, facts);
  w.endObject();
  return text;
}

}

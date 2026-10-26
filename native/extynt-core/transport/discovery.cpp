// Writes, removes and tokenises the discovery record through which the sidecar finds the running plugin.
#include "discovery.h"

#include <array>
#include <fstream>
#include <ios>
#include <cstddef>
#include <string>
#include <string_view>

#include "discovery_platform.h"
#include "json_writer.h"
#include "path_text.h"

namespace extynt {

namespace {

bool recordHolds(const std::string& path, const std::string& token) {
  std::ifstream file(pathFromUtf8(path), std::ios::binary);
  if (!file) return false;
  std::string content(1023, '\0');
  file.read(content.data(), static_cast<std::streamsize>(content.size()));
  content.resize(static_cast<size_t>(file.gcount()));
  return token.empty() || content.find(token) != std::string::npos;
}

}

std::string discoveryFileName(bool engine) { return engine ? "native-engine.json" : "native.json"; }

std::string discoveryJson(const DiscoveryRecord& record) {
  std::string text;
  JsonWriter w(text);
  w.beginObject();
  w.fieldInt("port", record.port);
  w.field("token", record.token);
  w.fieldInt("pid", record.pid);
  w.field("aeVersion", record.aeVersion);
  w.field("pluginVersion", record.pluginVersion);
  w.endObject();
  text += '\n';
  return text;
}

bool writeDiscoveryFile(const std::string& path, const DiscoveryRecord& record, std::string& error) {
  if (path.empty()) {
    error = "no discovery path";
    return false;
  }
  if (!ensureParentDirectories(path, error)) return false;
  return platform::writeFileAtomically(path, discoveryJson(record), error);
}

void removeDiscoveryFile(const std::string& path, const std::string& token) {
  if (path.empty() || !recordHolds(path, token)) return;
  const std::string claimed = path + ".removing." + std::to_string(platform::currentProcessId());
  if (!platform::moveFileIfAbsent(path, claimed)) return;
  if (recordHolds(claimed, token) || !platform::moveFileIfAbsent(claimed, path)) platform::removeFile(claimed);
}

bool makeToken(std::string& token) {
  std::array<unsigned char, 32> bytes{};
  if (!platform::randomBytes(bytes.data(), bytes.size())) return false;
  static constexpr std::string_view kDigits = "0123456789abcdef";
  token.clear();
  for (const unsigned char byte : bytes) {
    token += kDigits[byte >> 4];
    token += kDigits[byte & 15];
  }
  return true;
}

}

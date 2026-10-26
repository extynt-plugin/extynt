// The discovery file the sidecar and the spike tool read to find the plugin's socket.
#pragma once

#include <string>

namespace extynt {

struct DiscoveryRecord {
  int port = 0;
  std::string token;
  long long pid = 0;
  std::string aeVersion;
  std::string pluginVersion;
};

// "native.json" for the After Effects the user works in; "native-engine.json" for the headless render engine that
// collects the effect catalogue, so an engine never takes over the user's session.
std::string discoveryFileName(bool engine);

// macOS: ~/Library/Application Support/extynt/<discoveryFileName>. Windows: %LOCALAPPDATA%/extynt/<discoveryFileName>
// (forward slashes). Empty when it cannot be determined (and on Linux, where only the tests run).
std::string defaultDiscoveryPath(bool engine = false);

std::string discoveryJson(const DiscoveryRecord& record);

// Creates the parent directories of `file` (mode 0700 on POSIX; the user's own profile folder on Windows).
bool ensureParentDirectories(const std::string& file, std::string& error);

// Creates parent directories (0700), writes via a temp file with mode 0600, then renames into place.
bool writeDiscoveryFile(const std::string& path, const DiscoveryRecord& record, std::string& error);

// Removes the file only if it still holds `token` (another AE instance may have replaced it).
void removeDiscoveryFile(const std::string& path, const std::string& token);

// 32 random bytes as 64 hex digits, from the OS entropy source.
bool makeToken(std::string& token);

}

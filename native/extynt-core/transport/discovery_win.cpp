// Windows half of discovery_platform.h: atomic file writes in the user's private profile folder, process id and
// entropy.
#include <windows.h>
#include <bcrypt.h>

#include <filesystem>
#include <fstream>
#include <ios>
#include <string>
#include <system_error>

#include "discovery.h"
#include "discovery_platform.h"
#include "path_text.h"
#include "windows_paths.h"

namespace extynt {

std::string defaultDiscoveryPath(bool engine) {
  const std::string directory = win::stateDirectoryPath();
  return directory.empty() ? "" : directory + "/" + discoveryFileName(engine);
}

bool ensureParentDirectories(const std::string& file, std::string& error) {
  const std::filesystem::path parent = pathFromUtf8(file).parent_path();
  if (parent.empty()) return true;
  std::error_code code;
  std::filesystem::create_directories(parent, code);
  if (code) {
    error = "create_directories " + utf8FromPath(parent) + ": " + code.message();
    return false;
  }
  return true;
}

}

namespace extynt::platform {

namespace {

bool writeTemporary(const std::filesystem::path& temp, const std::string& body, std::string& error) {
  std::ofstream out(temp, std::ios::binary | std::ios::trunc);
  out.write(body.data(), static_cast<std::streamsize>(body.size()));
  out.close();
  if (out.fail()) {
    error = "write " + utf8FromPath(temp) + " failed";
    return false;
  }
  return true;
}

}

bool writeFileAtomically(const std::string& path, const std::string& body, std::string& error) {
  const std::filesystem::path target = pathFromUtf8(path);
  const std::filesystem::path temp = pathFromUtf8(path + ".tmp." + std::to_string(currentProcessId()));
  if (!writeTemporary(temp, body, error)) return false;
  if (::MoveFileExW(temp.c_str(), target.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) == 0) {
    error = "MoveFileExW " + path + ": error " + std::to_string(::GetLastError());
    std::error_code ignored;
    std::filesystem::remove(temp, ignored);
    return false;
  }
  return true;
}

void removeFile(const std::string& path) {
  std::error_code ignored;
  std::filesystem::remove(pathFromUtf8(path), ignored);
}

bool moveFileIfAbsent(const std::string& from, const std::string& to) {
  return ::MoveFileExW(pathFromUtf8(from).c_str(), pathFromUtf8(to).c_str(), MOVEFILE_WRITE_THROUGH) != 0;
}

long long currentProcessId() { return static_cast<long long>(::GetCurrentProcessId()); }

bool randomBytes(unsigned char* out, size_t count) {
  const NTSTATUS status = ::BCryptGenRandom(nullptr, out, static_cast<ULONG>(count), BCRYPT_USE_SYSTEM_PREFERRED_RNG);
  return status >= 0;
}

}

// Windows only. The path of the executable that loaded the plugin (After Effects itself).
#pragma once

#include <windows.h>

#include <array>
#include <string>

namespace extynt::ae {

// The host executable's full path, or an empty string when Windows cannot say or the path is longer than MAX_PATH.
inline std::wstring hostExecutablePath() {
  std::array<wchar_t, MAX_PATH> path{};
  const DWORD length = GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
  if (length == 0 || length >= path.size()) return {};
  return {path.data(), length};
}

}

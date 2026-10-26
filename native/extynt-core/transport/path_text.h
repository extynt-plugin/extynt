// UTF-8 text <-> std::filesystem::path. Paths travel through the plugin as UTF-8 std::string; on Windows the narrow
// std::filesystem and fstream constructors would read them as the ANSI code page and break on a non-ASCII user name,
// so every file access converts through here. On macOS and Linux the two functions are the identity.
#pragma once

#include <filesystem>
#include <string>

namespace extynt {

inline std::filesystem::path pathFromUtf8(const std::string& text) { return std::filesystem::u8path(text); }

inline std::string utf8FromPath(const std::filesystem::path& path) {
  const auto text = path.u8string();
  return {text.begin(), text.end()};
}

}

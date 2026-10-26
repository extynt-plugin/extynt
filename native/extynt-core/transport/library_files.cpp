// Finds the host jsx library directories and reads the manifest that names their files.
#include "library_files.h"

#include <cstddef>
#include <filesystem>
#include <fstream>
#include <ios>
#include <sstream>
#include <string>
#include <system_error>
#include <vector>

#include "host_reader.h"
#include "library_locate.h"
#include "path_text.h"

#ifndef EXTYNT_DEV_LIBRARY_BUILD
#define EXTYNT_DEV_LIBRARY_BUILD 0
#endif

namespace extynt {

namespace {

constexpr size_t kMaxManifestBytes = size_t{64} << 10;

std::string readManifest(const std::string& directory) {
  const std::ifstream file(pathFromUtf8(directory + "/manifest.json"), std::ios::binary);
  if (!file) return "";
  std::ostringstream buffer;
  buffer << file.rdbuf();
  const std::string text = buffer.str();
  return text.size() > kMaxManifestBytes ? "" : text;
}

bool isFile(const std::string& path) {
  std::error_code error;
  return std::filesystem::is_regular_file(pathFromUtf8(path), error);
}

}

bool devLibraryBuild() { return EXTYNT_DEV_LIBRARY_BUILD != 0; }

std::vector<std::string> libraryDirectories(bool allowUser, const std::string& home) {
  std::vector<std::string> directories;
  const std::string system = systemLibraryDirectory();
  if (!system.empty()) directories.push_back(system);
  if (allowUser && !home.empty()) directories.push_back(userLibraryDirectory(home));
  return directories;
}

std::vector<std::string> defaultLibraryDirectories() {
  return libraryDirectories(devLibraryBuild(), userLibraryBase());
}

LibraryEntry findLibrary(const std::vector<std::string>& directories) {
  std::vector<LibraryCandidate> candidates;
  candidates.reserve(directories.size());
  for (const std::string& directory : directories)
    candidates.push_back(LibraryCandidate{directory, readManifest(directory)});
  LibraryEntry entry = chooseLibrary(candidates);
  if (!entry.entryFile.empty() && !isFile(entry.entryFile)) {
    entry.note = "the manifest in " + entry.extensionDir + " names " + entry.entryFile + ", which does not exist";
    entry.entryFile.clear();
  }
  return entry;
}

}

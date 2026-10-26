// Finding the host jsx library on disk (docs/native/protocol.md, 3.1). POSIX only, no SDK: unit-tested on Linux.
#pragma once

#include <string>
#include <vector>

#include "host_reader.h"

namespace extynt {

#ifndef _WIN32
// The root-owned directory the installer package fills; the only one a release build reads, so a shipped plugin never
// runs jsx that a user process could have written. (Windows: %PROGRAMDATA%/extynt/host, from systemLibraryDirectory();
// a standard user cannot write there.)
constexpr const char* kSystemLibraryDirectory = "/Library/Application Support/extynt/host";
#endif

// True when this build was configured with EXTYNT_DEV_LIBRARY=ON (it then also reads the per-user directory).
bool devLibraryBuild();

// The directories to search, in order: the system one, then (only with `allowUser`) "<home>/Library/Application
// Support/extynt/host" when `home` is not empty. On Windows `home` is the local app data folder and the user directory
// is "<home>/extynt/host".
std::vector<std::string> libraryDirectories(bool allowUser, const std::string& home);

// The system directory above, per platform (library_paths_posix.cpp, library_paths_win.cpp).
std::string systemLibraryDirectory();
// The user-writable directory below `home` (see libraryDirectories); `home` is not empty.
std::string userLibraryDirectory(const std::string& home);
// What defaultLibraryDirectories passes as `home`: the home folder, the local app data folder on Windows.
std::string userLibraryBase();

// This build's directories: libraryDirectories(devLibraryBuild(), userLibraryBase()).
std::vector<std::string> defaultLibraryDirectories();

// Reads manifest.json in each directory and returns the first usable library (core/library_locate.h). An entry file
// that does not exist leaves entryFile empty, so a broken installed library is reported instead of skipped.
LibraryEntry findLibrary(const std::vector<std::string>& directories);

}

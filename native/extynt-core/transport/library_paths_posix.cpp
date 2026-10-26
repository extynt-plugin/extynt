// The macOS locations of the host library.
#include <string>

#include "home_directory.h"
#include "library_files.h"

namespace extynt {

std::string systemLibraryDirectory() { return kSystemLibraryDirectory; }

std::string userLibraryDirectory(const std::string& home) { return home + "/Library/Application Support/extynt/host"; }

std::string userLibraryBase() { return homeDirectory(); }

}

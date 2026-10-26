// The Windows locations of the host library.
#include <string>

#include "library_files.h"
#include "windows_paths.h"

namespace extynt {

std::string systemLibraryDirectory() {
  const std::string base = win::programDataDirectory();
  return base.empty() ? "" : base + "/extynt/host";
}

std::string userLibraryDirectory(const std::string& home) { return home + "/extynt/host"; }

std::string userLibraryBase() { return win::localAppDataDirectory(); }

}

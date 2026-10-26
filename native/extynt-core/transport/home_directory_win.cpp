// Windows home directory lookup from the profile folder.
#include <string>

#include "home_directory.h"
#include "windows_paths.h"

namespace extynt {

std::string environmentHomeDirectory() {
  const std::string home = win::environmentVariable("HOME");
  return home.empty() ? win::environmentVariable("USERPROFILE") : home;
}

std::string accountHomeDirectory() { return win::profileDirectory(); }

}

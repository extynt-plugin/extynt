// Resolves the user's home directory once and caches it.
#include "home_directory.h"

#include <string>

namespace extynt {

namespace {

const std::string& homeFromEnvironment() {
  static const std::string home = environmentHomeDirectory();
  return home;
}

}

std::string chooseHomeDirectory(const std::string& environmentHome, const std::string& accountHome) {
  return environmentHome.empty() ? accountHome : environmentHome;
}

std::string homeDirectory() { return chooseHomeDirectory(homeFromEnvironment(), accountHomeDirectory()); }

}

// The one rule for the current user's home folder, shared by the discovery file and the extension-folder lookup.
#pragma once

#include <string>

namespace extynt {

// The rule: `environmentHome` when it is not empty, else `accountHome`.
std::string chooseHomeDirectory(const std::string& environmentHome, const std::string& accountHome);

// The home folder from the account database (getpwuid_r; the shell's profile folder on Windows); "" when it cannot be
// read. Implemented per platform in home_directory_posix.cpp and home_directory_win.cpp.
std::string accountHomeDirectory();

// The process environment's idea of the home folder: $HOME (%USERPROFILE% on Windows); "" when unset. Per platform.
std::string environmentHomeDirectory();

// $HOME when set and non-empty, else the account database; "" when neither names a folder. $HOME is read once, on the
// first call, which is on the main thread at plugin start (both users run there before any socket thread exists).
std::string homeDirectory();

}

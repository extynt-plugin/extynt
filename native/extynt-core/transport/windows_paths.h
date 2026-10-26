// Windows only (compiled and included only by Windows targets): the per-user and per-machine folders extynt uses, as
// UTF-8 with forward slashes (the Win32 file calls and the C++ file streams accept them, so the portable code joins
// paths with '/').
#pragma once

#include <string>

namespace extynt::win {

// UTF-8 <-> UTF-16 for the Win32 wide calls. Empty on failure.
std::wstring widen(const std::string& utf8);
std::string narrow(const std::wstring& wide);

// %LOCALAPPDATA% (the state directory's parent), %PROGRAMDATA% and the user profile. Empty when the shell cannot say.
std::string localAppDataDirectory();
std::string programDataDirectory();
std::string profileDirectory();

// A process environment variable, or "" when it is not set.
std::string environmentVariable(const std::string& name);

// "<local app data>/extynt": the sidecar's state directory. Empty when the shell cannot say.
std::string stateDirectoryPath();

}

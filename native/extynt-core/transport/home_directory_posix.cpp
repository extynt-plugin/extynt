// POSIX home directory lookup from the account database.
#include <pwd.h>
#include <unistd.h>

#include <array>
#include <cstdlib>
#include <string>

#include "home_directory.h"

namespace extynt {

namespace {

constexpr size_t kPasswdBufferBytes = 4096;

}

std::string environmentHomeDirectory() {
  const char* value = std::getenv("HOME");
  return value == nullptr ? std::string() : std::string(value);
}

std::string accountHomeDirectory() {
  std::array<char, kPasswdBufferBytes> buffer{};
  passwd entry{};
  passwd* found = nullptr;
  if (::getpwuid_r(::getuid(), &entry, buffer.data(), buffer.size(), &found) != 0) return "";
  if (found == nullptr || found->pw_dir == nullptr) return "";
  return found->pw_dir;
}

}

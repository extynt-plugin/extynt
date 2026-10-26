// POSIX half of discovery_platform.h: private atomic file writes, renames, process id and entropy.
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cstdio>
#include <fstream>
#include <ios>
#include <string>
#include <vector>

#include "discovery.h"
#include "discovery_platform.h"
#include "errno_text.h"
#include "sdk_posix_open.h"
#ifdef __APPLE__
#include "home_directory.h"
#endif

namespace extynt {

std::string defaultDiscoveryPath(bool engine) {
#ifdef __APPLE__
  const std::string home = homeDirectory();
  if (home.empty()) return "";
  return home + "/Library/Application Support/extynt/" + discoveryFileName(engine);
#else
  (void)engine;
  return "";
#endif
}

bool ensureParentDirectories(const std::string& file, std::string& error) {
  for (size_t i = 1; i < file.size(); ++i) {
    if (file[i] != '/') continue;
    const std::string part = file.substr(0, i);
    if (::mkdir(part.c_str(), 0700) != 0 && errno != EEXIST) {
      error = "mkdir " + part + ": " + errnoText(errno);
      return false;
    }
  }
  return true;
}

}

namespace extynt::platform {

namespace {

bool writeAll(int fd, const std::string& body, std::string& error) {
  size_t written = 0;
  while (written < body.size()) {
    const ssize_t n = ::write(fd, body.data() + written, body.size() - written);
    if (n < 0) {
      if (errno == EINTR) continue;
      error = std::string("write: ") + errnoText(errno);
      return false;
    }
    written += static_cast<size_t>(n);
  }
  return true;
}

}

bool writeFileAtomically(const std::string& path, const std::string& body, std::string& error) {
  const std::string temp = path + ".tmp." + std::to_string(currentProcessId());
  const int fd = posix::createOrTruncate(temp.c_str());
  if (fd < 0) {
    error = "open " + temp + ": " + errnoText(errno);
    return false;
  }
  ::fchmod(fd, 0600);
  const bool written = writeAll(fd, body, error);
  ::close(fd);
  if (!written) {
    ::unlink(temp.c_str());
    return false;
  }
  if (::rename(temp.c_str(), path.c_str()) != 0) {
    error = "rename " + temp + ": " + errnoText(errno);
    ::unlink(temp.c_str());
    return false;
  }
  return true;
}

void removeFile(const std::string& path) { ::unlink(path.c_str()); }

bool moveFileIfAbsent(const std::string& from, const std::string& to) {
  struct stat info{};
  if (::lstat(to.c_str(), &info) == 0 || errno != ENOENT) return false;
  return ::rename(from.c_str(), to.c_str()) == 0;
}

long long currentProcessId() { return static_cast<long long>(::getpid()); }

bool randomBytes(unsigned char* out, size_t count) {
  std::ifstream source("/dev/urandom", std::ios::binary);
  if (!source) return false;
  std::vector<char> raw(count);
  source.read(raw.data(), static_cast<std::streamsize>(count));
  if (source.gcount() != static_cast<std::streamsize>(count)) return false;
  std::transform(raw.begin(), raw.end(), out, [](char byte) { return static_cast<unsigned char>(byte); });
  return true;
}

}

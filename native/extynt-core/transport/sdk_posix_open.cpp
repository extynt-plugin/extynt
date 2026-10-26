// The variadic open and openat calls (see sdk_posix_open.h).
#include "sdk_posix_open.h"

#include <fcntl.h>

namespace extynt::posix {

namespace {

constexpr unsigned kPrivateFileMode = 0600U;

}

int openDirectoryNoFollow(const char* path) { return ::open(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC); }

int openReadOnlyNoFollowAt(int directory, const char* name) {
  return ::openat(directory, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
}

int createExclusiveAt(int directory, const char* name) {
  return ::openat(directory, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, kPrivateFileMode);
}

int createOrTruncate(const char* path) {
  return ::open(path, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, kPrivateFileMode);
}

}

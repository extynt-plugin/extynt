// What discovery.cpp needs from the operating system. Implemented in discovery_posix.cpp and discovery_win.cpp.
#pragma once

#include <cstddef>
#include <string>

namespace extynt::platform {

// Writes `body` to `path` through a temporary file in the same folder and replaces `path` with it in one step, so a
// reader never sees half a file. The file is readable by the current user only.
bool writeFileAtomically(const std::string& path, const std::string& body, std::string& error);

// Removes the file; a missing file is not an error.
void removeFile(const std::string& path);

// Renames `from` to `to` only when `to` does not exist yet; false when nothing was moved.
bool moveFileIfAbsent(const std::string& from, const std::string& to);

// The id of this process (written to the discovery file so the sidecar can tell a dead owner from a live one).
long long currentProcessId();

// Fills `out` with `count` bytes from the operating system's entropy source.
bool randomBytes(unsigned char* out, size_t count);

}

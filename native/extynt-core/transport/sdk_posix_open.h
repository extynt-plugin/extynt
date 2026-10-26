// The only place the plugin calls the variadic POSIX open family: each caller gets a function with its flags fixed,
// so no other file passes C varargs. POSIX only.
#pragma once

namespace extynt::posix {

// Opens the directory `path` read-only for use as a descriptor base; a symbolic link at `path` is refused. -1 on
// failure.
int openDirectoryNoFollow(const char* path);

// Opens `name` inside the directory `directory` read-only and non-blocking, refusing a symbolic link. -1 on failure.
int openReadOnlyNoFollowAt(int directory, const char* name);

// Creates `name` inside the directory `directory` for writing with permissions 0600; fails when it already exists.
// -1 on failure.
int createExclusiveAt(int directory, const char* name);

// Creates or truncates the file `path` for writing with permissions 0600, closed on exec like the others. -1 on
// failure.
int createOrTruncate(const char* path);

}

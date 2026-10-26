// The host jsx library's manifest (docs/native/protocol.md, 3.1). Pure core: string decisions only; reading the
// candidate manifests from disk is transport/library_files.cpp.
#pragma once

#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "host_reader.h"

namespace extynt {

constexpr const char* kLibraryManifestSchema = "extynt-host-library/1";

// `entry` is relative to the manifest's directory and never contains "..".
struct LibraryManifest {
  std::string version;
  std::string entry;
};

// ^[0-9A-Za-z._+-]{1,64}$: the version is written into a script, so nothing else is allowed.
bool isValidLibraryVersion(std::string_view version);

// The manifest in `text`, or nothing (with `problem` saying why) when it is not JSON, has another schema, lacks a
// version string, or names an entry that is empty, absolute or contains "..". The version's characters are checked by
// host_call (LIBRARY_VERSION_INVALID), not here, so a bad version is reported rather than silently skipped.
std::optional<LibraryManifest> parseLibraryManifest(std::string_view text, std::string& problem);

// One directory that may hold a manifest.json; `manifestText` is empty when the file was missing or unreadable.
struct LibraryCandidate {
  std::string directory;
  std::string manifestText;
};

// The first candidate whose manifest parses: entryFile is directory + "/" + entry, extensionDir the directory. With
// none, entryFile is empty and `note` says what was looked at.
LibraryEntry chooseLibrary(const std::vector<LibraryCandidate>& candidates);

}

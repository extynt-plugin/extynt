// Chooses the host jsx library to load: validates a version string and reads a candidate directory's manifest.json.
#include "library_locate.h"

#include <algorithm>
#include <cstddef>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "host_reader.h"
#include "json_decode.h"

namespace extynt {

namespace {

constexpr size_t kMaxVersionLength = 64;

constexpr std::string_view kVersionPunctuation = "._+-";

bool isAsciiAlphanumeric(char c) { return (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'); }

bool versionChar(char c) { return isAsciiAlphanumeric(c) || kVersionPunctuation.find(c) != std::string_view::npos; }

bool safeRelativePath(const std::string& path) {
  return !path.empty() && path[0] != '/' && path.find("..") == std::string::npos &&
         path.find('\\') == std::string::npos;
}

}

bool isValidLibraryVersion(std::string_view version) {
  if (version.empty() || version.size() > kMaxVersionLength) return false;
  return std::all_of(version.begin(), version.end(), versionChar);
}

std::optional<LibraryManifest> parseLibraryManifest(std::string_view text, std::string& problem) {
  const ObjectDocument document = readObjectDocument(text);
  if (!document.object) {
    problem = "manifest.json is not a JSON object";
    return std::nullopt;
  }
  if (document.object->string("schema") != kLibraryManifestSchema) {
    problem = std::string("manifest.json schema is not ") + kLibraryManifestSchema;
    return std::nullopt;
  }
  const std::optional<std::string> version = document.object->string("version");
  const std::optional<std::string> entry = document.object->string("entry");
  if (!version || !entry || !safeRelativePath(*entry)) {
    problem = "manifest.json needs a version and a relative entry without \"..\"";
    return std::nullopt;
  }
  return LibraryManifest{*version, *entry};
}

LibraryEntry chooseLibrary(const std::vector<LibraryCandidate>& candidates) {
  LibraryEntry result;
  std::string note;
  for (const LibraryCandidate& candidate : candidates) {
    std::string problem;
    const std::optional<LibraryManifest> manifest =
        candidate.manifestText.empty() ? std::nullopt : parseLibraryManifest(candidate.manifestText, problem);
    if (!manifest) {
      if (!note.empty()) note += "; ";
      note += candidate.directory + ": " + (candidate.manifestText.empty() ? "no manifest.json" : problem);
      continue;
    }
    result.entryFile = candidate.directory + "/" + manifest->entry;
    result.extensionDir = candidate.directory;
    result.version = manifest->version;
    result.note = "found " + candidate.directory + " (version " + manifest->version + ")";
    return result;
  }
  result.note = note.empty() ? "no library directories to search" : note;
  return result;
}

}

// The library manifest, the locator's directory rule and reading manifests from disk.
#include <cstddef>
#include <filesystem>
#include <fstream>
#include <ios>
#include <string>
#include <vector>

#include "host_reader.h"
#include "library_files.h"
#include "library_locate.h"
#include "temp_dir.h"
#include "testing.h"

using namespace extynt;

namespace {

const char* const kGoodManifest =
    R"({"schema":"extynt-host-library/1","version":"0.1.0+0123456789ab","entry":"probe.jsx"})";

void writeFile(const std::filesystem::path& path, const std::string& text) {
  std::filesystem::create_directories(path.parent_path());
  std::ofstream file(path, std::ios::binary);
  file << text;
}

TEST(manifest_is_parsed_and_unsafe_ones_refused) {
  std::string problem;
  const auto good = parseLibraryManifest(kGoodManifest, problem);
  CHECK_EQ(testing::need(good, "manifest").version, std::string("0.1.0+0123456789ab"));
  CHECK_EQ(testing::need(good, "manifest").entry, std::string("probe.jsx"));
  for (const char* bad : {"not json", "[]", R"({"schema":"other/1","version":"1","entry":"probe.jsx"})",
                          R"({"schema":"extynt-host-library/1","entry":"probe.jsx"})",
                          R"({"schema":"extynt-host-library/1","version":"1"})",
                          R"({"schema":"extynt-host-library/1","version":"1","entry":"/etc/passwd"})",
                          R"({"schema":"extynt-host-library/1","version":"1","entry":"../x.jsx"})",
                          R"({"schema":"extynt-host-library/1","version":"1","entry":"a\\b.jsx"})",
                          R"({"schema":"extynt-host-library/1","version":"1","entry":""})"}) {
    problem.clear();
    CHECK(!parseLibraryManifest(bad, problem).has_value());
    CHECK(!problem.empty());
  }
}

TEST(library_version_characters) {
  CHECK(isValidLibraryVersion("0.1.0+0123456789ab"));
  CHECK(isValidLibraryVersion("A_b-c.1"));
  CHECK(isValidLibraryVersion(std::string(64, 'a')));
  CHECK(!isValidLibraryVersion(""));
  CHECK(!isValidLibraryVersion(std::string(65, 'a')));
  for (const char* bad : {"1\"2", "1 2", "1;2", "1\n", "1\\2", "1/2", "1\xE2\x80\xA8"})
    CHECK(!isValidLibraryVersion(bad));
}

TEST(the_first_candidate_with_a_usable_manifest_wins) {
  const LibraryEntry none = chooseLibrary({});
  CHECK(none.entryFile.empty());
  CHECK(!none.note.empty());
  const LibraryEntry picked =
      chooseLibrary({{"/a", ""}, {"/b", "garbage"}, {"/c", kGoodManifest}, {"/d", kGoodManifest}});
  CHECK_EQ(picked.entryFile, std::string("/c/probe.jsx"));
  CHECK_EQ(picked.extensionDir, std::string("/c"));
  CHECK_EQ(picked.version, std::string("0.1.0+0123456789ab"));
  const LibraryEntry skipped = chooseLibrary({{"/a", ""}, {"/b", "garbage"}});
  CHECK(skipped.entryFile.empty());
  CHECK(skipped.note.find("/a") != std::string::npos);
  CHECK(skipped.note.find("/b") != std::string::npos);
  CHECK_EQ(skipped.note, std::string("/a: no manifest.json; /b: manifest.json is not a JSON object"));
  CHECK_EQ(chooseLibrary({{"/a", ""}}).note, std::string("/a: no manifest.json"));
}

TEST(release_builds_search_only_the_system_directory) {
  const std::vector<std::string> release = libraryDirectories(false, "/Users/x");
  CHECK_EQ(release.size(), size_t(1));
  CHECK_EQ(release[0], std::string("/Library/Application Support/extynt/host"));
  const std::vector<std::string> dev = libraryDirectories(true, "/Users/x");
  CHECK_EQ(dev.size(), size_t(2));
  CHECK_EQ(dev[0], std::string("/Library/Application Support/extynt/host"));
  CHECK_EQ(dev[1], std::string("/Users/x/Library/Application Support/extynt/host"));
  CHECK_EQ(libraryDirectories(true, "").size(), size_t(1));
  CHECK_EQ(defaultLibraryDirectories().size(), devLibraryBuild() ? size_t(2) : size_t(1));
  CHECK_EQ(defaultLibraryDirectories()[0], std::string(kSystemLibraryDirectory));
}

TEST(manifests_are_read_from_disk_and_a_missing_entry_is_reported) {
  const std::filesystem::path root = testing::makeTempDir("extynt-library");
  const std::string system = (root / "system").string();
  const std::string user = (root / "user").string();
  CHECK(findLibrary({system, user}).entryFile.empty());

  writeFile(root / "user/manifest.json", kGoodManifest);
  writeFile(root / "user/probe.jsx", "// library");
  const LibraryEntry fromUser = findLibrary({system, user});
  CHECK_EQ(fromUser.entryFile, user + "/probe.jsx");
  CHECK_EQ(fromUser.version, std::string("0.1.0+0123456789ab"));

  writeFile(root / "system/manifest.json", R"({"schema":"extynt-host-library/1","version":"9","entry":"main.jsx"})");
  const LibraryEntry broken = findLibrary({system, user});
  CHECK(broken.entryFile.empty());
  CHECK(broken.note.find("main.jsx") != std::string::npos);
  writeFile(root / "system/main.jsx", "// library");
  CHECK_EQ(findLibrary({system, user}).entryFile, system + "/main.jsx");
}

}

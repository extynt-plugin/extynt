// The stream bridge's exchange folder refuses what is not ours and never follows a link.
#include <sys/stat.h>

#include <filesystem>
#include <fstream>
#include <ios>
#include <iterator>
#include <optional>
#include <string>
#include <utility>

#include "exchange_folder.h"
#include "temp_dir.h"
#include "testing.h"

using namespace extynt;
namespace fs = std::filesystem;

namespace {

void writeText(const fs::path& path, const std::string& text) {
  std::ofstream out(path, std::ios::binary);
  out << text;
}

std::string readText(const fs::path& path) {
  std::ifstream in(path, std::ios::binary);
  return {std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
}

ExchangeFolder mustOpen(const std::string& path) {
  std::string why;
  std::optional<ExchangeFolder> folder = ExchangeFolder::open(path, why);
  if (!folder) throw testing::Failure{"cannot open the folder: " + why};
  return std::move(*folder);
}

unsigned modeOf(const fs::path& path) {
  struct stat info{};
  CHECK(::stat(path.c_str(), &info) == 0);
  return static_cast<unsigned>(info.st_mode) & 0777U;
}

TEST(the_folder_is_created_private_and_a_loose_one_is_tightened) {
  const fs::path base = testing::makeTempDir("extynt-exchange");
  std::string why;
  CHECK(ExchangeFolder::open((base / "new").string(), why).has_value());
  CHECK_EQ(modeOf(base / "new"), 0700U);
  fs::create_directory(base / "loose");
  fs::permissions(base / "loose", fs::perms::all);
  CHECK(ExchangeFolder::open((base / "loose").string(), why).has_value());
  CHECK_EQ(modeOf(base / "loose"), 0700U);
}

TEST(a_symlink_in_place_of_the_folder_is_refused) {
  const fs::path base = testing::makeTempDir("extynt-exchange");
  fs::create_directory(base / "real");
  fs::create_directory_symlink(base / "real", base / "link");
  std::string why;
  CHECK(!ExchangeFolder::open((base / "link").string(), why).has_value());
  CHECK(!why.empty());
}

TEST(a_request_is_read_once_and_removed) {
  const fs::path base = testing::makeTempDir("extynt-exchange");
  std::string why;
  const ExchangeFolder folder = mustOpen(base.string());
  CHECK_EQ(folder.takeRequest(1024, why), std::string());
  writeText(base / "request.json", R"({"a":1})");
  CHECK_EQ(folder.takeRequest(1024, why), std::string(R"({"a":1})"));
  CHECK(!fs::exists(base / "request.json"));
}

TEST(a_request_that_is_a_link_or_too_big_is_refused_and_removed) {
  const fs::path base = testing::makeTempDir("extynt-exchange");
  const fs::path secret = base / "secret.txt";
  writeText(secret, "do not read me");
  std::string why;
  const ExchangeFolder folder = mustOpen((base / "x").string());
  fs::create_symlink(secret, base / "x" / "request.json");
  CHECK_EQ(folder.takeRequest(1024, why), std::string());
  CHECK(fs::exists(secret));
  writeText(base / "x" / "request.json", std::string(100, 'a'));
  CHECK_EQ(folder.takeRequest(10, why), std::string());
  CHECK(!fs::exists(base / "x" / "request.json"));
}

TEST(a_hard_linked_request_is_refused) {
  const fs::path base = testing::makeTempDir("extynt-exchange");
  writeText(base / "other.txt", "{}");
  std::string why;
  const ExchangeFolder folder = mustOpen((base / "x").string());
  fs::create_hard_link(base / "other.txt", base / "x" / "request.json");
  CHECK_EQ(folder.takeRequest(1024, why), std::string());
}

TEST(the_response_is_private_and_never_written_through_a_link) {
  const fs::path base = testing::makeTempDir("extynt-exchange");
  const fs::path victim = base / "victim.txt";
  writeText(victim, "keep");
  std::string why;
  const ExchangeFolder folder = mustOpen((base / "x").string());
  fs::create_symlink(victim, base / "x" / "response.json");
  CHECK(folder.putResponse("answer", why));
  CHECK_EQ(readText(victim), std::string("keep"));
  CHECK_EQ(readText(base / "x" / "response.json"), std::string("answer"));
  CHECK_EQ(modeOf(base / "x" / "response.json"), 0600U);
  CHECK(!fs::is_symlink(base / "x" / "response.json"));
}

}

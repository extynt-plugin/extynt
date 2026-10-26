// The plug-in file walk, the macOS bundle reader and the background scan, over temp folders and fake sources.
#include <chrono>
#include <cstddef>
#include <filesystem>
#include <fstream>
#include <ios>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

#include "options_dialog_index.h"
#include "options_dialogs.h"
#include "pipl_builders.h"
#include "pipl.h"
#include "plugin_files.h"
#include "temp_dir.h"
#include "testing.h"

using namespace extynt;
using namespace pipltest;

namespace {

namespace fs = std::filesystem;

void writeBytes(const fs::path& path, const std::string& bytes) {
  fs::create_directories(path.parent_path());
  std::ofstream file(path, std::ios::binary);
  file << bytes;
}

TEST(a_bundle_reader_finds_the_pipl_in_the_rsrc_and_nothing_in_other_files) {
  const fs::path root = testing::makeTempDir("extynt-bundle");
  const fs::path bundle = root / "Effects" / "Numbers.plugin";
  writeBytes(bundle / "Contents" / "Resources" / "Numbers.rsrc",
             makeFork({{fourCC('P', 'i', 'P', 'L'), {makePipl("ADBE Numbers", 1U << 5, false)}}}));
  writeBytes(bundle / "Contents" / "Resources" / "readme.txt", "not a resource file");
  writeBytes(bundle / "Contents" / "Resources" / "broken.rsrc", "garbage");
  PluginLayout layout;
  layout.kind = PluginKind::Bundle;
  layout.roots = {root.string()};
  const std::unique_ptr<PiplSource> source = makeFilePiplSource(layout);
  const std::vector<std::string> files = source->pluginFiles();
  CHECK_EQ(files.size(), size_t{1});
  const std::vector<EffectDialogFlag> rows = scanOptionsDialogs(*source);
  CHECK_EQ(rows.size(), size_t{1});
  CHECK_EQ(rows[0].matchName, std::string("ADBE Numbers"));
  CHECK(rows[0].hasOptionsDialog);
  fs::remove_all(root);
}

TEST(the_aex_walk_takes_aex_files_and_single_files_and_uses_the_given_reader) {
  const fs::path root = testing::makeTempDir("extynt-aex");
  writeBytes(root / "Plug-ins" / "Effects" / "Blur.AEX", "x");
  writeBytes(root / "Plug-ins" / "Effects" / "notes.txt", "x");
  writeBytes(root / "AfterFX.exe", "x");
  PluginLayout layout;
  layout.roots = {(root / "Plug-ins").string(), (root / "AfterFX.exe").string(), (root / "missing").string()};
  layout.readFile = [](const std::string& file) {
    const bool blur = file.find("Blur") != std::string::npos;
    return std::vector<std::string>{makePipl(blur ? "ADBE Blur" : "ADBE Builtin", blur ? 0U : (1U << 5), true)};
  };
  const std::unique_ptr<PiplSource> source = makeFilePiplSource(layout);
  CHECK_EQ(source->pluginFiles().size(), size_t{2});
  const std::vector<EffectDialogFlag> rows = scanOptionsDialogs(*source);
  CHECK_EQ(rows.size(), size_t{2});
  CHECK_EQ(rows[0].matchName, std::string("ADBE Blur"));
  CHECK(!rows[0].hasOptionsDialog);
  CHECK(rows[1].hasOptionsDialog);
  fs::remove_all(root);
}

class OneEffectSource : public PiplSource {
 public:
  std::vector<std::string> pluginFiles() override { return {"one"}; }
  std::vector<std::string> readPipls([[maybe_unused]] const std::string& file) override {
    return {makePipl("ADBE One", 1U << 5, false)};
  }
};

class ThrowingSource : public PiplSource {
 public:
  std::vector<std::string> pluginFiles() override { throw std::runtime_error("disk"); }
  std::vector<std::string> readPipls([[maybe_unused]] const std::string& file) override { return {}; }
};

std::optional<std::vector<EffectDialogFlag>> waitFor(const OptionsDialogIndex& index, bool expectResult) {
  for (int i = 0; i < 400; ++i) {
    if (index.snapshot() || !expectResult) break;
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
  }
  return index.snapshot();
}

TEST(the_index_scans_in_the_background_and_a_failed_scan_stays_unknown) {
  const OptionsDialogIndex ok(std::make_unique<OneEffectSource>());
  const auto rows = waitFor(ok, true);
  CHECK(rows.has_value());
  CHECK_EQ(rows ? rows->size() : size_t{0}, size_t{1});
  CHECK(rows.has_value() && !rows->empty() && rows->front().hasOptionsDialog);
  const OptionsDialogIndex failed(std::make_unique<ThrowingSource>());
  std::this_thread::sleep_for(std::chrono::milliseconds(50));
  CHECK(!failed.snapshot().has_value());
}

}

// Enumerates the plug-in files under the After Effects plug-in roots.
#include "plugin_files.h"

#include <algorithm>
#include <cctype>
#include <cstddef>
#include <filesystem>
#include <fstream>
#include <ios>
#include <iterator>
#include <memory>
#include <string>
#include <string_view>
#include <system_error>
#include <utility>
#include <vector>

#include "options_dialogs.h"
#include "path_text.h"
#include "pipl.h"

namespace extynt {

namespace {

namespace fs = std::filesystem;

constexpr const char* kAexExtension = ".aex";
constexpr const char* kBundleExtension = ".plugin";
constexpr const char* kResourceExtension = ".rsrc";

std::string lowerExtension(const fs::path& path) {
  std::string text = utf8FromPath(path.extension());
  std::transform(text.begin(), text.end(), text.begin(),
                 [](char c) { return static_cast<char>(std::tolower(static_cast<unsigned char>(c))); });
  return text;
}

bool wantedEntry(PluginKind kind, const fs::directory_entry& entry) {
  std::error_code error;
  if (kind == PluginKind::Aex) return entry.is_regular_file(error) && lowerExtension(entry.path()) == kAexExtension;
  return entry.is_directory(error) && lowerExtension(entry.path()) == kBundleExtension;
}

bool withinWalkLimits(const std::vector<std::string>& out, size_t visited) {
  return out.size() < kMaxPluginFiles && visited < kMaxWalkedEntries;
}

void walkRoot(const PluginLayout& layout, const std::string& root, std::vector<std::string>& out) {
  std::error_code error;
  const fs::path start = pathFromUtf8(root);
  if (fs::is_regular_file(start, error)) {
    out.push_back(root);
    return;
  }
  fs::recursive_directory_iterator it(start, fs::directory_options::skip_permission_denied, error);
  size_t visited = 0;
  for (; !error && it != fs::recursive_directory_iterator() && withinWalkLimits(out, visited); it.increment(error)) {
    ++visited;
    if (it.depth() >= kMaxWalkDepth) it.disable_recursion_pending();
    if (!wantedEntry(layout.kind, *it)) continue;
    out.push_back(utf8FromPath(it->path()));
    if (layout.kind == PluginKind::Bundle) it.disable_recursion_pending();
  }
}

std::string readSmallFile(const fs::path& path) {
  std::ifstream file(path, std::ios::binary);
  if (!file) return "";
  const std::string bytes(std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>{});
  return bytes.size() > kMaxResourceForkBytes ? "" : bytes;
}

class FilePiplSource : public PiplSource {
 public:
  explicit FilePiplSource(PluginLayout layout) : layout_(std::move(layout)) {}

  std::vector<std::string> pluginFiles() override {
    std::vector<std::string> files;
    for (const std::string& root : layout_.roots) walkRoot(layout_, root, files);
    return files;
  }

  std::vector<std::string> readPipls(const std::string& file) override {
    if (layout_.kind == PluginKind::Bundle) return bundlePipls(file);
    return layout_.readFile ? layout_.readFile(file) : std::vector<std::string>{};
  }

 private:
  PluginLayout layout_;
};

}

std::vector<std::string> bundlePipls(const std::string& bundleDirectory) {
  std::vector<std::string> out;
  std::error_code error;
  fs::directory_iterator it(pathFromUtf8(bundleDirectory) / "Contents" / "Resources", error);
  for (; !error && it != fs::directory_iterator(); it.increment(error)) {
    if (lowerExtension(it->path()) != kResourceExtension) continue;
    const std::string fork = readSmallFile(it->path());
    for (const std::string_view resource : forkResources(fork, fourCC('P', 'i', 'P', 'L'))) out.emplace_back(resource);
  }
  return out;
}

std::unique_ptr<PiplSource> makeFilePiplSource(PluginLayout layout) {
  return std::make_unique<FilePiplSource>(std::move(layout));
}

}

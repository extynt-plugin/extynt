// Finding After Effects' effect plug-in files on disk and reading their PiPL resources, for the Options-dialog flag
// (core/options_dialogs.h). The file walk is the same on both platforms; the platform supplies the folders and, on
// Windows, the reader of a .aex's resources. A macOS bundle's PiPL is a classic resource-fork image in
// Contents/Resources/*.rsrc (Rez -useDF), which is plain file reading and so lives here.
#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

#include "options_dialogs.h"

namespace extynt {

constexpr size_t kMaxWalkedEntries = 200000;
constexpr int kMaxWalkDepth = 8;

// Aex: a file named *.aex (Windows) whose resources PluginLayout::readFile reads. Bundle: a folder named *.plugin
// (macOS) whose .rsrc files are read here.
enum class PluginKind : uint8_t {
  Aex,
  Bundle,
};

// `roots` are searched recursively (a path that is a file is taken as a plug-in file as it is); `readFile`, Aex only,
// returns the bytes of each 'PiPL' resource in one file.
struct PluginLayout {
  PluginKind kind = PluginKind::Aex;
  std::vector<std::string> roots;
  std::function<std::vector<std::string>(const std::string&)> readFile;
};

// The PiPL resources of the macOS bundle at `bundleDirectory`, from every .rsrc directly in its Contents/Resources.
std::vector<std::string> bundlePipls(const std::string& bundleDirectory);

std::unique_ptr<PiplSource> makeFilePiplSource(PluginLayout layout);

}

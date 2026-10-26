// macOS plug-in layout: the Plug-ins folder next to the After Effects application folder's app bundle
// ("/Applications/Adobe After Effects <year>/Plug-ins") and Adobe's shared Common/Plug-ins. Each .plugin bundle's PiPL
// is in its Contents/Resources/*.rsrc, read as a plain file by transport/plugin_files.cpp.
#include <CoreFoundation/CoreFoundation.h>

#include <array>
#include <cstddef>
#include <string>

#include "ae_plugin_layout.h"
#include "host_mode.h"
#include "plugin_files.h"

namespace extynt::ae {

namespace {

constexpr CFIndex kMaxPathBytes = 4096;

std::string mainBundlePath() {
  CFBundleRef bundle = CFBundleGetMainBundle();
  const CFURLRef url = bundle != nullptr ? CFBundleCopyBundleURL(bundle) : nullptr;
  if (url == nullptr) return "";
  const CFStringRef text = CFURLCopyFileSystemPath(url, kCFURLPOSIXPathStyle);
  CFRelease(url);
  if (text == nullptr) return "";
  std::array<char, kMaxPathBytes> buffer{};
  const Boolean copied =
      CFStringGetCString(text, buffer.data(), static_cast<CFIndex>(buffer.size()), kCFStringEncodingUTF8);
  CFRelease(text);
  return copied != 0 ? std::string(buffer.data()) : std::string();
}

std::string applicationFolder(const std::string& bundlePath) {
  const size_t slash = bundlePath.find_last_of('/');
  return slash == std::string::npos || slash == 0 ? "" : bundlePath.substr(0, slash);
}

}

PluginLayout hostPluginLayout() {
  PluginLayout layout;
  layout.kind = PluginKind::Bundle;
  const std::string folder = applicationFolder(outerAppBundle(mainBundlePath()));
  if (!folder.empty()) layout.roots.push_back(folder + "/Plug-ins");
  layout.roots.emplace_back("/Library/Application Support/Adobe/Common/Plug-ins");
  return layout;
}

}

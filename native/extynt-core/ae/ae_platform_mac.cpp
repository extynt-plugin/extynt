// The macOS platform adapter: host bundle location, home directory and the AE version string.
#include <CoreFoundation/CoreFoundation.h>
#include <crt_externs.h>

#include <unistd.h>

#include <array>
#include <string>
#include <vector>

#include "ae_log.h"
#include "ae_platform.h"
#include "host_mode.h"
#include "launch_agent.h"

namespace extynt::ae {

namespace {

std::string bundleString(CFBundleRef bundle, CFStringRef key) {
  CFTypeRef value = CFBundleGetValueForInfoDictionaryKey(bundle, key);
  if (!value || CFGetTypeID(value) != CFStringGetTypeID()) return "";
  std::array<char, 128> buffer{};
  const Boolean copied = CFStringGetCString(static_cast<CFStringRef>(value), buffer.data(),
                                            static_cast<CFIndex>(buffer.size()), kCFStringEncodingUTF8);
  if (copied == 0) return "";
  return buffer.data();
}

std::string urlPath(CFURLRef url) {
  const CFStringRef text = url != nullptr ? CFURLCopyFileSystemPath(url, kCFURLPOSIXPathStyle) : nullptr;
  if (text == nullptr) return "";
  std::array<char, 4096> buffer{};
  const Boolean copied =
      CFStringGetCString(text, buffer.data(), static_cast<CFIndex>(buffer.size()), kCFStringEncodingUTF8);
  CFRelease(text);
  return copied != 0 ? std::string(buffer.data()) : std::string();
}

CFBundleRef bundleAtPath(const std::string& path) {
  const CFStringRef text = CFStringCreateWithCString(kCFAllocatorDefault, path.c_str(), kCFStringEncodingUTF8);
  if (text == nullptr) return nullptr;
  const CFURLRef url =
      CFURLCreateWithFileSystemPath(kCFAllocatorDefault, text, kCFURLPOSIXPathStyle, static_cast<Boolean>(1));
  CFRelease(text);
  if (url == nullptr) return nullptr;
  CFBundleRef bundle = CFBundleCreate(kCFAllocatorDefault, url);
  CFRelease(url);
  return bundle;
}

CFBundleRef createHostBundle() {
  CFBundleRef main = CFBundleGetMainBundle();
  if (main == nullptr) return nullptr;
  const CFURLRef mainUrl = CFBundleCopyBundleURL(main);
  const std::string path = urlPath(mainUrl);
  if (mainUrl != nullptr) CFRelease(mainUrl);
  const std::string outer = outerAppBundle(path);
  if (outer.empty() || outer == path) {
    CFRetain(main);
    return main;
  }
  CFBundleRef outerBundle = bundleAtPath(outer);
  if (outerBundle != nullptr) return outerBundle;
  CFRetain(main);
  return main;
}

void logKickstart(const KickstartResult& result) {
  logLine(result.spawned ? "launchctl kickstart " + std::string(kSidecarLaunchLabel) + ": exit " +
                               std::to_string(result.exitCode) + (result.timedOut ? " (killed after the timeout)" : "")
                         : "launchctl kickstart did not start: " + result.error);
}

}

std::string hostVersionString() {
  CFBundleRef bundle = createHostBundle();
  if (!bundle) return "unknown";
  std::string version = bundleString(bundle, CFSTR("CFBundleShortVersionString"));
  const std::string build = bundleString(bundle, CFSTR("CFBundleVersion"));
  CFRelease(bundle);
  if (version.empty()) version = "unknown";
  if (!build.empty()) version += " (build " + build + ")";
  return version;
}

bool hostIsHeadless() {
  std::vector<std::string> arguments;
  const int count = *_NSGetArgc();
  const char* const* const values = *_NSGetArgv();
  for (int i = 0; i < count && values != nullptr; ++i) {
    if (values[i] != nullptr) arguments.emplace_back(values[i]);
  }
  return headlessHost(arguments);
}

const char* hostArchitecture() {
#ifdef __arm64__
  return "arm64";
#else
  return "x86_64";
#endif
}

void startSidecar(Kickstart& kickstart) {
  kickstart.start("/bin/launchctl", kickstartArguments(::getuid(), kSidecarLaunchLabel), logKickstart);
}

}

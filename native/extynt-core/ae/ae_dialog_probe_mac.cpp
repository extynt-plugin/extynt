// macOS dialog probe. AppKit's NSApp.modalWindow may only be read on the main thread, which is the thread that is
// busy, so this reads the window server's list instead: a thread-safe C call that reports this process's on-screen
// windows (and their titles, which a process may always read for its own windows). AppKit gives a modal window the
// modal-panel level (8), above document windows (0) and floating palettes (3).
#include <CoreFoundation/CoreFoundation.h>
#include <CoreGraphics/CoreGraphics.h>

#include <unistd.h>

#include <array>
#include <memory>
#include <optional>
#include <string>

#include "ae_dialog_probe.h"
#include "dialog_probe.h"

namespace extynt::ae {

namespace {

constexpr int kModalPanelLevel = 8;
constexpr CFIndex kMaxTitleBytes = 1024;

bool integerEntry(CFDictionaryRef window, CFStringRef key, int& out) {
  const CFTypeRef value = CFDictionaryGetValue(window, key);
  if (value == nullptr || CFGetTypeID(value) != CFNumberGetTypeID()) return false;
  return CFNumberGetValue(static_cast<CFNumberRef>(value), kCFNumberIntType, &out) != 0;
}

std::string titleEntry(CFDictionaryRef window) {
  const CFTypeRef value = CFDictionaryGetValue(window, kCGWindowName);
  if (value == nullptr || CFGetTypeID(value) != CFStringGetTypeID()) return "";
  std::array<char, kMaxTitleBytes> buffer{};
  if (CFStringGetCString(static_cast<CFStringRef>(value), buffer.data(), static_cast<CFIndex>(buffer.size()),
                         kCFStringEncodingUTF8) == 0) {
    return "";
  }
  return buffer.data();
}

bool isOurModal(CFDictionaryRef window, int pid) {
  int owner = 0;
  int level = 0;
  return integerEntry(window, kCGWindowOwnerPID, owner) && owner == pid &&
         integerEntry(window, kCGWindowLayer, level) && level == kModalPanelLevel;
}

class MacDialogProbe : public DialogProbe {
 public:
  std::optional<DialogInfo> current() override {
    const CFArrayRef list = CGWindowListCopyWindowInfo(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID);
    if (list == nullptr) return std::nullopt;
    std::optional<DialogInfo> found;
    const int pid = static_cast<int>(getpid());
    for (CFIndex i = 0; i < CFArrayGetCount(list) && !found; ++i) {
      const CFTypeRef entry = CFArrayGetValueAtIndex(list, i);
      if (entry == nullptr || CFGetTypeID(entry) != CFDictionaryGetTypeID()) continue;
      const auto* const window = static_cast<CFDictionaryRef>(entry);
      if (isOurModal(window, pid)) found = DialogInfo{titleEntry(window)};
    }
    CFRelease(list);
    return found;
  }
};

}

std::unique_ptr<DialogProbe> makeDialogProbe() { return std::make_unique<MacDialogProbe>(); }

}

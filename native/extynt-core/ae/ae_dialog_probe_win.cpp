// Windows dialog probe: reports the title of the modal dialog After Effects is showing, from window state of this
// process alone (see ae_dialog_scan_win.h).
#include <windows.h>

#include <memory>
#include <optional>

#include "ae_dialog_probe.h"
#include "ae_dialog_scan_win.h"

namespace extynt::ae {

namespace {

class WindowsDialogProbe : public DialogProbe {
 public:
  std::optional<DialogInfo> current() override {
    HWND dialog = findModalDialogWindow();
    if (dialog == nullptr) return std::nullopt;
    return DialogInfo{dialogTitle(dialog)};
  }
};

}

std::unique_ptr<DialogProbe> makeDialogProbe() { return std::make_unique<WindowsDialogProbe>(); }

}

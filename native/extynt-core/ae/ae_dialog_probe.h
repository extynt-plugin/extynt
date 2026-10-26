// The platform half of live dialog detection (core/dialog_probe.h): which window After Effects shows right now while
// its main thread is busy in a script. One implementation per platform (ae_dialog_probe_win.cpp,
// ae_dialog_probe_mac.cpp).
#pragma once

#include <memory>

#include "dialog_probe.h"

namespace extynt::ae {

// The probe for this process. It reads window state only, and is safe to call from a socket thread.
std::unique_ptr<DialogProbe> makeDialogProbe();

}

// Objective-C++ only. The one NSEvent local monitor that routes keys to the panel's web views and gives them focus on
// click. See ae_panel_monitor.mm.
#pragma once

namespace extynt::ae::panel {

// Main thread. Installs the process-wide monitor (once) and logs whether it worked.
void installMonitor();

// Main thread. Removes the monitor if it is installed.
void removeMonitor();

}

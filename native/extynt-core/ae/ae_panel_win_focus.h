// Windows only. Gives the keyboard back to a panel's web view when its top-level window is brought to the front again.
#pragma once

namespace extynt::ae::panel {

// Installs the foreground watch on the calling (main) thread once; removes it. Both are safe to repeat.
void installForegroundWatch();
void removeForegroundWatch();

}

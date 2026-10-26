// Runs Cocoa and WebKit callback bodies so that no C++ exception crosses back into the framework.
#pragma once

#include "ae_log.h"

namespace extynt::ae::panel {

// Calls `work` and logs, instead of propagating, any exception it throws.
template <typename Work>
void guarded(Work work) noexcept {
  try {
    work();
  } catch (...) {
    logDroppedException("panel view");
  }
}

}

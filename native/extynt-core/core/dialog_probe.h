// Live detection of a window After Effects opened while a host call runs (docs/native/protocol.md, 3.5). Some effects
// open a modal dialog when they are added (a file picker, an options or licence window) and no script can suppress it.
// The platform probe (ae/) looks at the process's windows from a socket thread; this file is the platform-free half:
// the interface, and the tracker that turns "a window is up now" into "waiting on <title> since <ms>".
#pragma once

#include <mutex>
#include <optional>
#include <string>

#include "timing.h"

namespace extynt {

struct DialogInfo {
  // May be empty: some dialogs have no caption
  std::string title;
};

// Called on a socket thread while the main thread is busy, so it never touches the SDK or AppKit objects. At most one
// call at a time (the tracker serialises them). Returns the topmost modal window, or nothing.
class DialogProbe {
 public:
  DialogProbe() = default;
  virtual ~DialogProbe() = default;
  DialogProbe(const DialogProbe&) = delete;
  DialogProbe& operator=(const DialogProbe&) = delete;
  DialogProbe(DialogProbe&&) = delete;
  DialogProbe& operator=(DialogProbe&&) = delete;

  virtual std::optional<DialogInfo> current() = 0;
};

struct DialogReport {
  std::string title;
  // Since this probe first saw this title; a later title or a gap starts over
  double sinceMs = 0;
};

class DialogTracker {
 public:
  explicit DialogTracker(DialogProbe* probe) : probe_(probe) {}

  // Nothing while no call runs (an idle After Effects with a window open is not a stalled call) or without a probe.
  std::optional<DialogReport> observe(bool callRunning, SteadyClock::time_point now);

 private:
  struct Seen {
    std::string title;
    SteadyClock::time_point since;
  };

  DialogProbe* probe_;
  std::mutex mutex_;
  std::optional<Seen> seen_;
};

}

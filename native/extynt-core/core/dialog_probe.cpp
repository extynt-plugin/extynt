// The tracker half of dialog detection (declared in dialog_probe.h): remembers the first sighting of a window title and
// reports how long the host call has waited on it.

#include "dialog_probe.h"

#include <mutex>
#include <optional>

#include "timing.h"

namespace extynt {

std::optional<DialogReport> DialogTracker::observe(bool callRunning, SteadyClock::time_point now) {
  const std::scoped_lock lock(mutex_);
  std::optional<DialogInfo> found;
  if (callRunning && probe_ != nullptr) found = probe_->current();
  if (!found) {
    seen_.reset();
    return std::nullopt;
  }
  if (!seen_ || seen_->title != found->title) seen_ = Seen{found->title, now};
  return DialogReport{seen_->title, elapsedMs(seen_->since, now)};
}

}

// What the socket thread knows without asking the main thread: the numbers ping_direct reports
// (docs/native/protocol.md, 3.5). The transport fills DirectStatus; the library resolution is written by host_call on
// the main thread and read on the socket thread, so it sits behind a mutex.
#pragma once

#include <cstdint>
#include <mutex>
#include <optional>
#include <string>

#include "dialog_probe.h"

namespace extynt {

struct LibrarySnapshot {
  // Empty until the first host_call resolved a library
  std::string version;
  // Empty until the first host_call resolved a library
  std::string entryFile;
};

class LibraryStatus {
 public:
  void set(const std::string& version, const std::string& entryFile) {
    const std::scoped_lock lock(mutex_);
    snapshot_ = LibrarySnapshot{version, entryFile};
  }
  [[nodiscard]] LibrarySnapshot get() const {
    const std::scoped_lock lock(mutex_);
    return snapshot_;
  }

 private:
  mutable std::mutex mutex_;
  LibrarySnapshot snapshot_;
};

struct DirectStatus {
  // Since the idle hook last ran; nothing before its first tick
  std::optional<double> idleAgeMs;
  uint64_t idleTicks = 0;
  // Jobs waiting for the main thread
  uint64_t queueDepth = 0;
  // Age of the oldest waiting job; nothing when none waits
  std::optional<double> oldestQueuedMs;
  int watchers = 0;
  LibrarySnapshot library;
  // A window After Effects shows while a host call runs; nothing otherwise
  std::optional<DialogReport> dialog;
};

}

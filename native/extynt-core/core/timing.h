// Per-response timing report and the clocks that fill it. Pure core, no SDK.
#pragma once

#include <chrono>
#include <cstdint>
#include <string>

#include "json_writer.h"

namespace extynt {

struct Timing {
  // Worker enqueue -> idle hook dequeue
  double queuedMs = 0;
  // Host reads + traversal (total minus serialize and hash)
  double walkMs = 0;
  // XXH3-128 work, including the host reads that feed content digests (contentMs)
  double hashMs = 0;
  // Of hashMs: key, text, marker, path and layer-reference content digests
  double contentMs = 0;
  // JSON writing
  double serializeMs = 0;
  // Idle hook dequeue -> response string ready
  double totalMainThreadMs = 0;
  // Response payload bytes, excluding the timing object itself
  uint64_t bytes = 0;
  // AEGP suite calls made for the request
  uint64_t getterCalls = 0;
  // What ran the request: "idle" (the AEGP idle hook) or "socket" (answered on the socket thread, no main-thread hop).
  const char* dispatchedBy = "idle";

  void write(JsonWriter& writer) const;
};

using SteadyClock = std::chrono::steady_clock;

inline double elapsedMs(SteadyClock::time_point from, SteadyClock::time_point to) {
  return std::chrono::duration<double, std::milli>(to - from).count();
}

// Accumulates the time spent inside scopes into a nanosecond counter.
class ScopedAccumulate {
 public:
  explicit ScopedAccumulate(int64_t& sink) : sink_(sink), start_(SteadyClock::now()) {}
  ~ScopedAccumulate() {
    sink_ += std::chrono::duration_cast<std::chrono::nanoseconds>(SteadyClock::now() - start_).count();
  }
  ScopedAccumulate(const ScopedAccumulate&) = delete;
  ScopedAccumulate& operator=(const ScopedAccumulate&) = delete;
  ScopedAccumulate(ScopedAccumulate&&) = delete;
  ScopedAccumulate& operator=(ScopedAccumulate&&) = delete;

 private:
  int64_t& sink_;
  SteadyClock::time_point start_;
};

}

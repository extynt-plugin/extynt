// What one idle-hook call does on the main thread, shared by the AE plugin and the fake server so the watch path is
// tested on Linux: note the tick, drain queued requests, and publish a watch line when one is due. No SDK includes.
#pragma once

#include "executor.h"
#include "host_reader.h"
#include "server.h"
#include "timing.h"
#include "watch.h"

namespace extynt {

// The longest one idle slice drains queued work, so the After Effects UI stays responsive.
constexpr double kIdleDrainBudgetMs = 8.0;

class IdleTurn {
 public:
  IdleTurn(Server& server, HostReader& host, WatchTracker& watch) : server_(&server), host_(&host), watch_(&watch) {}

  // The idle hook's whole job: noteTick, then work() when there is any. The AE plugin calls the three parts itself so
  // its error-quieting wrapper only surrounds work().
  void run(SteadyClock::time_point now);
  void noteTick() const noexcept { server_->noteIdleTick(); }
  // A request is queued, or a watch sample is due.
  [[nodiscard]] bool hasWork(SteadyClock::time_point now) const;
  // Drains the queue within the budget, then samples and publishes if due. Never throws.
  void work(SteadyClock::time_point now) noexcept;

 private:
  void sampleAndPublish(double nowMs);

  Server* server_;
  HostReader* host_;
  WatchTracker* watch_;
};

// Milliseconds on the plugin's steady clock, as the events' `at`.
double steadyMs(SteadyClock::time_point now);

}

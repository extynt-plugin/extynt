// One idle-hook turn on the main thread: drains queued requests within a time budget and publishes due watch samples.
#include "idle_turn.h"

#include <chrono>
#include <optional>
#include <ratio>
#include <string>

#include "executor.h"
#include "request.h"
#include "timing.h"
#include "watch.h"

namespace extynt {

double steadyMs(SteadyClock::time_point now) {
  return std::chrono::duration<double, std::milli>(now.time_since_epoch()).count();
}

bool IdleTurn::hasWork(SteadyClock::time_point now) const {
  if (server_->hasPending()) return true;
  if (!server_->hasWatchers()) return false;
  return server_->initialRequested() || watch_->sampleDue(steadyMs(now), server_->watchIntervalMs());
}

void IdleTurn::sampleAndPublish(double nowMs) {
  if (server_->takeInitialRequest()) watch_->requestInitial();
  if (!watch_->claimSample(nowMs, server_->watchIntervalMs())) return;
  host_->beginRequest();
  const WatchSample sample = watch_->take(*host_);
  const std::optional<std::string> line = watch_->observe(sample, nowMs, server_->watchStillMs());
  if (line) server_->publish(*line);
}

void IdleTurn::work(SteadyClock::time_point now) noexcept {
  try {
    const ExecContext context{&server_->info(), watch_, &server_->libraryStatus()};
    if (server_->hasPending()) {
      server_->drain([this, &context](const Request& request,
                                      double queuedMs) { return executeRequest(request, *host_, context, queuedMs); },
                     kIdleDrainBudgetMs);
    }
    if (server_->hasWatchers()) sampleAndPublish(steadyMs(now));
  } catch (...) {
    return;
  }
}

void IdleTurn::run(SteadyClock::time_point now) {
  noteTick();
  if (hasWork(now)) work(now);
}

}

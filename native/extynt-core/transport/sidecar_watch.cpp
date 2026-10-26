// The respawn decision and the thread that watches the sidecar link and starts the sidecar job again with backoff.
#include "sidecar_watch.h"

#include <chrono>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <utility>

namespace extynt {

namespace {

std::int64_t steadyNowMs() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch())
      .count();
}

}

RespawnDecision::RespawnDecision(RespawnConfig config, std::int64_t loadedAtMs)
    : config_(config), nextStartMs_(loadedAtMs + config.startupMs) {}

void RespawnDecision::noteLinked(std::int64_t nowMs) {
  if (!linked_) {
    linked_ = true;
    linkedSinceMs_ = nowMs;
    gaveUp_ = false;
  }
  if (nowMs - linkedSinceMs_ >= config_.stableMs) attempts_ = 0;
}

std::int64_t RespawnDecision::delayAfter(int attempts) const {
  std::int64_t delay = config_.firstDelayMs;
  for (int i = 1; i < attempts && delay < config_.maxDelayMs; ++i) delay *= 2;
  return delay < config_.maxDelayMs ? delay : config_.maxDelayMs;
}

RespawnAction RespawnDecision::tick(bool linked, std::int64_t nowMs) {
  if (linked) {
    noteLinked(nowMs);
    return RespawnAction::None;
  }
  if (linked_) {
    linked_ = false;
    nextStartMs_ = nowMs + config_.graceMs;
  }
  if (gaveUp_ || nowMs < nextStartMs_) return RespawnAction::None;
  if (attempts_ >= config_.maxAttempts) {
    gaveUp_ = true;
    return RespawnAction::GiveUp;
  }
  ++attempts_;
  nextStartMs_ = nowMs + delayAfter(attempts_);
  return RespawnAction::Start;
}

SidecarWatch::SidecarWatch(Callbacks callbacks, RespawnConfig config, int pollMs)
    : linked_(std::move(callbacks.linked)),
      startJob_(std::move(callbacks.startJob)),
      log_(std::move(callbacks.log)),
      config_(config),
      pollMs_(pollMs) {}

SidecarWatch::~SidecarWatch() { stop(); }

void SidecarWatch::start() {
  {
    const std::scoped_lock lock(mutex_);
    if (started_) return;
    started_ = true;
  }
  startJob();
  thread_ = std::thread(&SidecarWatch::loop, this);
}

void SidecarWatch::stop() {
  {
    const std::scoped_lock lock(mutex_);
    stopping_ = true;
  }
  wake_.notify_all();
  if (thread_.joinable()) thread_.join();
  if (kickstart_) kickstart_->join();
}

bool SidecarWatch::waitOrStop() {
  std::unique_lock<std::mutex> lock(mutex_);
  wake_.wait_for(lock, std::chrono::milliseconds(pollMs_), [this] { return stopping_; });
  return stopping_;
}

void SidecarWatch::startJob() {
  if (kickstart_) kickstart_->join();
  kickstart_ = std::make_unique<Kickstart>();
  startJob_(*kickstart_);
}

void SidecarWatch::act(RespawnAction action, int attempts) {
  if (action == RespawnAction::Start) {
    log_("sidecar link lost: starting the sidecar again (attempt " + std::to_string(attempts) + " of " +
         std::to_string(config_.maxAttempts) + ")");
    startJob();
  } else if (action == RespawnAction::GiveUp) {
    log_("sidecar did not come back after " + std::to_string(attempts) +
         " attempts; not starting it again until it links on its own");
  }
}

void SidecarWatch::loop() noexcept {
  try {
    RespawnDecision decision(config_, steadyNowMs());
    while (!waitOrStop()) {
      const RespawnAction action = decision.tick(linked_(), steadyNowMs());
      act(action, decision.attempts());
    }
  } catch (...) {
    return;
  }
}

}

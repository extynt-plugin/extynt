// Brings the sidecar back while After Effects runs: the plugin watches the sidecar's own link and starts its autostart
// job again, with a bounded backoff, when the link drops. Starting the job never makes a second sidecar, because the
// task ignores a new instance and launchctl kickstart without -k leaves a running job alone. Windows needs this because
// Task Scheduler restarts only a task that fails to launch; the same policy runs on macOS. No SDK.
#pragma once

#include <condition_variable>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

#include "launch_agent.h"

namespace extynt {

// The respawn policy in milliseconds: `startupMs` is how long the first start may take after load before it is tried
// again, `graceMs` how long a sidecar that is only reconnecting gets after the link drops, `firstDelayMs` the gap
// between starts (longer than a sidecar takes to boot) growing to `maxDelayMs`, `maxAttempts` the starts per outage
// before the plugin stops trying until the sidecar is back, and `stableMs` how long a held link ends the outage.
struct RespawnConfig {
  std::int64_t startupMs = 20000;
  std::int64_t graceMs = 2000;
  std::int64_t firstDelayMs = 10000;
  std::int64_t maxDelayMs = 30000;
  int maxAttempts = 6;
  std::int64_t stableMs = 60000;
};

enum class RespawnAction : std::uint8_t { None, Start, GiveUp };

// The decision alone, on a caller's clock in milliseconds: no threads, no processes.
class RespawnDecision {
 public:
  RespawnDecision(RespawnConfig config, std::int64_t loadedAtMs);

  // Called on every poll. Start means run the autostart job now; GiveUp is answered once, when the attempts are spent.
  RespawnAction tick(bool linked, std::int64_t nowMs);
  [[nodiscard]] int attempts() const { return attempts_; }

 private:
  void noteLinked(std::int64_t nowMs);
  [[nodiscard]] std::int64_t delayAfter(int attempts) const;

  RespawnConfig config_;
  bool linked_ = false;
  bool gaveUp_ = false;
  int attempts_ = 0;
  std::int64_t linkedSinceMs_ = 0;
  std::int64_t nextStartMs_;
};

// Watches the link through `Linked` (true while the sidecar holds it; callable from any thread) and runs `StartJob`
// (ae::startSidecar) when the decision says to.
class SidecarWatch {
 public:
  using Linked = std::function<bool()>;
  using StartJob = std::function<void(Kickstart&)>;
  using Log = std::function<void(const std::string&)>;
  struct Callbacks {
    Linked linked;
    StartJob startJob;
    Log log;
  };

  SidecarWatch(Callbacks callbacks, RespawnConfig config = {}, int pollMs = 500);
  ~SidecarWatch();
  SidecarWatch(const SidecarWatch&) = delete;
  SidecarWatch& operator=(const SidecarWatch&) = delete;
  SidecarWatch(SidecarWatch&&) = delete;
  SidecarWatch& operator=(SidecarWatch&&) = delete;

  // Starts the job once (the load-time start) and then the watch thread. Starting twice is ignored.
  void start();
  // Stops the thread and any start still running. Safe to call more than once; call it before the server stops, or
  // the closing link reads as a dead sidecar.
  void stop();

 private:
  void loop() noexcept;
  void act(RespawnAction action, int attempts);
  void startJob();
  bool waitOrStop();

  Linked linked_;
  StartJob startJob_;
  Log log_;
  RespawnConfig config_;
  int pollMs_;
  std::unique_ptr<Kickstart> kickstart_;
  std::mutex mutex_;
  std::condition_variable wake_;
  bool stopping_ = false;
  bool started_ = false;
  std::thread thread_;
};

}

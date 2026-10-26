// Bringing the sidecar back: when the plugin starts its job again, the backoff, the bound, and the watch thread.
#include <atomic>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <string>
#include <thread>
#include <vector>

#include "launch_agent.h"
#include "sidecar_watch.h"
#include "testing.h"

using namespace extynt;

namespace {

RespawnConfig smallConfig() {
  RespawnConfig config;
  config.startupMs = 1000;
  config.graceMs = 100;
  config.firstDelayMs = 100;
  config.maxDelayMs = 400;
  config.maxAttempts = 4;
  config.stableMs = 5000;
  return config;
}

std::vector<std::int64_t> startsBetween(RespawnDecision& decision, std::int64_t fromMs, std::int64_t toMs) {
  std::vector<std::int64_t> starts;
  for (std::int64_t now = fromMs; now <= toMs; now += 10) {
    if (decision.tick(false, now) == RespawnAction::Start) starts.push_back(now);
  }
  return starts;
}

TEST(a_sidecar_still_starting_at_load_is_given_the_startup_window) {
  RespawnDecision decision(smallConfig(), 0);
  CHECK(decision.tick(false, 990) == RespawnAction::None);
  CHECK(decision.tick(false, 1000) == RespawnAction::Start);
  CHECK_EQ(decision.attempts(), 1);
}

TEST(a_linked_sidecar_is_never_started) {
  RespawnDecision decision(smallConfig(), 0);
  for (std::int64_t now = 0; now < 20000; now += 10) CHECK(decision.tick(true, now) == RespawnAction::None);
  CHECK_EQ(decision.attempts(), 0);
}

TEST(a_dropped_link_waits_the_grace_then_backs_off_to_the_cap) {
  RespawnDecision decision(smallConfig(), 0);
  decision.tick(true, 0);
  const std::vector<std::int64_t> expected = {2100, 2200, 2400, 2800};
  CHECK(startsBetween(decision, 2000, 3500) == expected);
}

TEST(the_attempts_are_bounded_and_the_give_up_is_answered_once) {
  RespawnDecision decision(smallConfig(), 0);
  decision.tick(true, 0);
  int giveUps = 0;
  int starts = 0;
  for (std::int64_t now = 10; now < 60000; now += 10) {
    const RespawnAction action = decision.tick(false, now);
    if (action == RespawnAction::GiveUp) ++giveUps;
    if (action == RespawnAction::Start) ++starts;
  }
  CHECK_EQ(starts, 4);
  CHECK_EQ(giveUps, 1);
}

TEST(a_link_held_long_enough_ends_the_outage_and_a_short_one_does_not) {
  RespawnDecision decision(smallConfig(), 0);
  decision.tick(true, 0);
  CHECK_EQ(startsBetween(decision, 10, 250).size(), std::size_t{2});
  decision.tick(true, 300);
  decision.tick(true, 1000);
  CHECK_EQ(decision.attempts(), 2);
  decision.tick(true, 5300);
  CHECK_EQ(decision.attempts(), 0);
}

TEST(a_sidecar_that_keeps_crashing_after_the_give_up_is_not_started_again) {
  RespawnDecision decision(smallConfig(), 0);
  decision.tick(true, 0);
  CHECK_EQ(startsBetween(decision, 10, 10000).size(), std::size_t{4});
  decision.tick(true, 10010);
  CHECK(decision.tick(false, 10020) == RespawnAction::None);
  CHECK(decision.tick(false, 10120) == RespawnAction::GiveUp);
  CHECK_EQ(startsBetween(decision, 10130, 30000).size(), std::size_t{0});
}

TEST(the_watch_starts_the_job_at_load_and_again_while_unlinked_and_never_after_stop) {
  std::atomic<int> starts{0};
  std::atomic<bool> linked{false};
  std::vector<std::string> lines;
  RespawnConfig config = smallConfig();
  config.startupMs = 20;
  config.firstDelayMs = 20;
  config.maxDelayMs = 20;
  config.maxAttempts = 100;
  SidecarWatch watch({[&] { return linked.load(); }, [&](Kickstart&) { starts.fetch_add(1); },
                      [&](const std::string& line) { lines.push_back(line); }},
                     config, 5);
  watch.start();
  watch.start();
  for (int i = 0; i < 400 && starts.load() < 3; ++i) std::this_thread::sleep_for(std::chrono::milliseconds(5));
  CHECK(starts.load() >= 3);
  linked.store(true);
  watch.stop();
  const int seen = starts.load();
  std::this_thread::sleep_for(std::chrono::milliseconds(60));
  CHECK_EQ(starts.load(), seen);
  CHECK(!lines.empty());
  CHECK(lines.front().find("attempt 1 of 100") != std::string::npos);
}

}

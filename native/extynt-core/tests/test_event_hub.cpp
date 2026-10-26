// The watch event queues: ordering, overflow, closing and the cadence the subscribers asked for.
#include <chrono>
#include <cstddef>
#include <string>
#include <thread>

#include "event_hub.h"
#include "request.h"
#include "testing.h"

using namespace extynt;

namespace {

TEST(hub_delivers_lines_in_order_to_every_subscriber) {
  EventHub hub;
  const int first = hub.subscribe(100, 1000);
  const int second = hub.subscribe(100, 1000);
  CHECK_EQ(hub.count(), size_t(2));
  hub.publish("a");
  hub.publish("b");
  std::string line;
  CHECK(hub.waitNext(first, line, 0));
  CHECK_EQ(line, std::string("a"));
  CHECK(hub.waitNext(first, line, 0));
  CHECK_EQ(line, std::string("b"));
  CHECK(!hub.waitNext(first, line, 10));
  CHECK(!hub.closed());
  CHECK(hub.waitNext(second, line, 0));
  CHECK_EQ(line, std::string("a"));
}

TEST(a_full_queue_drops_its_oldest_line_and_reports_one_overflow) {
  EventHub hub;
  const int id = hub.subscribe(100, 1000);
  for (size_t i = 0; i < kEventQueueLimit + 12; ++i) hub.publish("line" + std::to_string(i));
  std::string line;
  CHECK(hub.waitNext(id, line, 0));
  CHECK_EQ(line, std::string(R"({"event":"overflow","dropped":12})"));
  CHECK(hub.waitNext(id, line, 0));
  CHECK_EQ(line, std::string("line12"));
  size_t rest = 1;
  while (hub.waitNext(id, line, 0)) ++rest;
  CHECK_EQ(rest, kEventQueueLimit);
  hub.publish("again");
  CHECK(hub.waitNext(id, line, 0));
  CHECK_EQ(line, std::string("again"));
}

TEST(unsubscribe_ends_the_queue_and_the_cadence_follows_the_subscribers) {
  EventHub hub;
  CHECK_EQ(hub.intervalMs(), kWatchIntervalMaxMs);
  CHECK_EQ(hub.stillMs(), kWatchStillMaxMs);
  const int slow = hub.subscribe(500, 5000);
  const int fast = hub.subscribe(60, 300);
  CHECK_EQ(hub.intervalMs(), 60);
  CHECK_EQ(hub.stillMs(), 300);
  hub.unsubscribe(fast);
  CHECK_EQ(hub.intervalMs(), 500);
  CHECK_EQ(hub.count(), size_t(1));
  std::string line;
  CHECK(!hub.waitNext(fast, line, 0));
  hub.unsubscribe(slow);
  CHECK_EQ(hub.count(), size_t(0));
}

TEST(close_flushes_what_is_queued_then_ends_every_wait) {
  EventHub hub;
  const int id = hub.subscribe(100, 1000);
  hub.publish("last");
  std::string line;
  std::thread waiter([&hub] {
    std::string ignored;
    const int other = hub.subscribe(100, 1000);
    hub.waitNext(other, ignored, 5000);
  });
  std::this_thread::sleep_for(std::chrono::milliseconds(20));
  hub.closeAll();
  waiter.join();
  CHECK(hub.closed());
  CHECK(hub.waitNext(id, line, 5000));
  CHECK_EQ(line, std::string("last"));
  CHECK(!hub.waitNext(id, line, 5000));
}

TEST(a_waiting_subscriber_wakes_when_a_line_arrives) {
  EventHub hub;
  const int id = hub.subscribe(100, 1000);
  std::thread publisher([&hub] {
    std::this_thread::sleep_for(std::chrono::milliseconds(30));
    hub.publish("late");
  });
  std::string line;
  CHECK(hub.waitNext(id, line, 5000));
  CHECK_EQ(line, std::string("late"));
  publisher.join();
}

}

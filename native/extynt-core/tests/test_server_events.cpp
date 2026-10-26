// The real server with the idle turn: the watch stream, ping_direct's stall numbers, and host_call over a socket.
#include <atomic>
#include <chrono>
#include <string>
#include <thread>

#include "fake_host.h"
#include "idle_turn.h"
#include "json_probe.h"
#include "net.h"
#include "server.h"
#include "socket_helpers.h"
#include "testing.h"
#include "timing.h"
#include "watch.h"

using namespace extynt;
using testing::connectTo;
using testing::member;
using testing::parsedReply;
using testing::readLine;
using testing::roundTrip;
using testing::sendLine;

namespace {

using Millis = std::chrono::milliseconds;

std::string request(const Server& server, const std::string& id, const std::string& rest) {
  return R"({"id":")" + id + R"(","token":")" + server.token() + "\"," + rest + "}";
}

class IdleThread {
 public:
  explicit IdleThread(IdleTurn& turn)
      : thread_([this, &turn] {
          while (!stop_.load()) {
            turn.run(SteadyClock::now());
            std::this_thread::sleep_for(Millis(1));
          }
        }) {}
  IdleThread(const IdleThread&) = delete;
  IdleThread& operator=(const IdleThread&) = delete;
  IdleThread(IdleThread&&) = delete;
  IdleThread& operator=(IdleThread&&) = delete;
  ~IdleThread() { stopNow(); }
  void stopNow() {
    stop_.store(true);
    if (thread_.joinable()) thread_.join();
  }

 private:
  std::atomic<bool> stop_{false};
  std::thread thread_;
};

ServerConfig testConfig() {
  ServerConfig config;
  config.info.pluginVersion = "0.4.0-test";
  config.info.arch = "arm64";
  return config;
}

void expectEvent(const JsonValue& line, const char* event, double seq) {
  CHECK_EQ(member(line, "event").text, std::string(event));
  CHECK_EQ(member(line, "seq").number, seq);
}

TEST(a_watcher_gets_initial_still_change_and_host_closing_lines_in_order) {
  fake::Host host = fake::makeScene();
  Server server(testConfig());
  std::string error;
  CHECK(server.start(error));
  WatchTracker tracker;
  IdleTurn turn(server, host, tracker);

  const net::Handle watch = connectTo(server.port());
  const JsonValue subscribed = parsedReply(roundTrip(watch, request(server, "w", R"("op":"watch")")));
  CHECK(member(subscribed, "ok").boolean);
  CHECK(member(member(subscribed, "result"), "subscribed").boolean);
  CHECK_EQ(member(member(subscribed, "result"), "intervalMs").number, 100.0);
  CHECK_EQ(member(member(subscribed, "result"), "stillMs").number, 1000.0);
  CHECK(server.hasWatchers());

  const SteadyClock::time_point t0 = SteadyClock::now();
  turn.run(t0);
  const JsonValue initial = parsedReply(readLine(watch));
  expectEvent(initial, "change", 1.0);
  CHECK_EQ(member(initial, "reason").items[0].text, std::string("initial"));
  CHECK_EQ(member(initial, "revision").number, 9264.0);
  CHECK(initial.find("id") == nullptr);

  turn.run(t0 + Millis(50));
  turn.run(t0 + Millis(100));
  turn.run(t0 + Millis(1000));
  const JsonValue still = parsedReply(readLine(watch));
  expectEvent(still, "still", 2.0);

  host.revision = 9265;
  turn.run(t0 + Millis(1100));
  const JsonValue change = parsedReply(readLine(watch));
  expectEvent(change, "change", 3.0);
  CHECK_EQ(member(change, "reason").items[0].text, std::string("revision"));
  CHECK_EQ(member(change, "revision").number, 9265.0);

  server.publish(tracker.hostClosingLine(steadyMs(t0 + Millis(2000))));
  server.stop();
  const JsonValue closing = parsedReply(readLine(watch));
  expectEvent(closing, "host-closing", 4.0);
  CHECK_EQ(readLine(watch), std::string(""));
  net::closeHandle(watch);
}

TEST(a_second_subscriber_gets_a_full_initial_state_and_hangup_ends_a_subscription) {
  fake::Host host = fake::makeScene();
  Server server(testConfig());
  std::string error;
  CHECK(server.start(error));
  WatchTracker tracker;
  IdleTurn turn(server, host, tracker);
  const net::Handle first = connectTo(server.port());
  roundTrip(first, request(server, "w", R"("op":"watch")"));
  const SteadyClock::time_point t0 = SteadyClock::now();
  turn.run(t0);
  CHECK_EQ(member(parsedReply(readLine(first)), "reason").items[0].text, std::string("initial"));

  const net::Handle second = connectTo(server.port());
  roundTrip(second, request(server, "w", R"("op":"watch","intervalMs":50,"stillMs":250)"));
  CHECK_EQ(server.watchIntervalMs(), 50);
  CHECK_EQ(server.watchStillMs(), 250);
  turn.run(t0 + Millis(200));
  CHECK_EQ(member(parsedReply(readLine(second)), "reason").items[0].text, std::string("initial"));
  CHECK_EQ(member(parsedReply(readLine(first)), "reason").items[0].text, std::string("initial"));

  net::closeHandle(first);
  net::closeHandle(second);
  for (int i = 0; i < 300 && server.hasWatchers(); ++i) std::this_thread::sleep_for(Millis(10));
  CHECK(!server.hasWatchers());
  server.stop();
}

TEST(watch_needs_the_token_and_valid_cadence) {
  Server server(testConfig());
  std::string error;
  CHECK(server.start(error));
  const net::Handle fd = connectTo(server.port());
  const JsonValue denied = parsedReply(roundTrip(fd, R"({"id":"w","op":"watch"})"));
  CHECK_EQ(member(member(denied, "error"), "code").text, std::string("UNAUTHORIZED"));
  const JsonValue range = parsedReply(roundTrip(fd, request(server, "w", R"("op":"watch","intervalMs":10)")));
  CHECK_EQ(member(member(range, "error"), "code").text, std::string("BAD_REQUEST"));
  const JsonValue nested = parsedReply(roundTrip(fd, request(server, "b", R"("op":"batch","ops":[{"op":"watch"}])")));
  CHECK_EQ(member(member(nested, "error"), "code").text, std::string("BAD_REQUEST"));
  CHECK(!server.hasWatchers());
  net::closeHandle(fd);
  server.stop();
}

void checkIdleBaseline(const JsonValue& before) {
  CHECK(member(before, "idleAgeMs").isNull() && member(before, "oldestQueuedMs").isNull());
  CHECK_EQ(member(before, "idleTicks").number, 0.0);
  CHECK_EQ(member(before, "queueDepth").number, 0.0);
  CHECK_EQ(member(before, "watchers").number, 0.0);
  CHECK_EQ(member(before, "arch").text, std::string("arm64"));
  const JsonValue& library = member(before, "library");
  CHECK(member(library, "version").isNull() && member(library, "entryFile").isNull());
  CHECK(member(before, "mainThread").boolean == false);
}

TEST(ping_direct_reports_the_idle_age_the_queue_and_the_library) {
  fake::Host host = fake::makeScene();
  Server server(testConfig());
  std::string error;
  CHECK(server.start(error));
  WatchTracker tracker;
  IdleTurn turn(server, host, tracker);
  const net::Handle control = connectTo(server.port());
  const std::string ping = request(server, "d", R"("op":"ping_direct")");

  const JsonValue before = member(parsedReply(roundTrip(control, ping)), "result");
  checkIdleBaseline(before);

  turn.noteTick();
  const JsonValue fresh = member(parsedReply(roundTrip(control, ping)), "result");
  CHECK(member(fresh, "idleAgeMs").number >= 0);
  CHECK(member(fresh, "idleAgeMs").number < 1000);
  CHECK_EQ(member(fresh, "idleTicks").number, 1.0);

  std::this_thread::sleep_for(Millis(80));
  const JsonValue stalled = member(parsedReply(roundTrip(control, ping)), "result");
  CHECK(member(stalled, "idleAgeMs").number >= 70);
  CHECK_EQ(member(stalled, "idleTicks").number, 1.0);

  const net::Handle command = connectTo(server.port());
  sendLine(command, request(server, "q", R"("op":"ping")"));
  for (int i = 0; i < 300 && !server.hasPending(); ++i) std::this_thread::sleep_for(Millis(10));
  const JsonValue queued = member(parsedReply(roundTrip(control, ping)), "result");
  CHECK_EQ(member(queued, "queueDepth").number, 1.0);
  CHECK(member(queued, "oldestQueuedMs").number >= 0);

  turn.run(SteadyClock::now());
  CHECK(member(parsedReply(readLine(command)), "ok").boolean);
  const JsonValue drained = member(parsedReply(roundTrip(control, ping)), "result");
  CHECK_EQ(member(drained, "queueDepth").number, 0.0);
  net::closeHandle(command);
  net::closeHandle(control);
  server.stop();
}

TEST(host_call_runs_through_the_server_and_ping_direct_then_names_the_library) {
  fake::Host host = fake::makeScene();
  host.entryAnswers["aeHostCensus"] = R"({"ok":true,"effects":[]})";
  Server server(testConfig());
  std::string error;
  CHECK(server.start(error));
  WatchTracker tracker;
  IdleTurn turn(server, host, tracker);
  const IdleThread idle(turn);
  const net::Handle command = connectTo(server.port());
  const JsonValue reply = parsedReply(roundTrip(
      command,
      request(server, "c", R"("op":"host_call","entry":"aeHostCensus","args":"{\"schemaVersion\":\"0.1\"}")")));
  CHECK(member(reply, "ok").boolean);
  CHECK_EQ(member(member(reply, "result"), "result").text, std::string(R"({"ok":true,"effects":[]})"));
  const JsonValue refused =
      parsedReply(roundTrip(command, request(server, "r", R"("op":"host_call","entry":"app.quit","args":"{}")")));
  CHECK_EQ(member(member(refused, "error"), "code").text, std::string("ENTRY_NOT_ALLOWED"));
  const JsonValue ping =
      member(parsedReply(roundTrip(command, request(server, "d", R"("op":"ping_direct")"))), "result");
  CHECK_EQ(member(member(ping, "library"), "version").text, std::string("0.1.0+0123456789ab"));
  CHECK(member(ping, "idleTicks").number > 0);
  net::closeHandle(command);
  server.stop();
}

}

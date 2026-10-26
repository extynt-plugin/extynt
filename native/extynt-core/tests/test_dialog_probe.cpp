// Live dialog detection: the tracker's since/title semantics, and ping_direct's waitingOnDialog while a host call runs.
#include <atomic>
#include <chrono>
#include <mutex>
#include <optional>
#include <string>
#include <thread>

#include "dialog_probe.h"
#include "json_probe.h"
#include "net.h"
#include "request.h"
#include "server.h"
#include "socket_helpers.h"
#include "testing.h"
#include "timing.h"

using namespace extynt;
using testing::connectTo;
using testing::member;
using testing::parsedReply;
using testing::roundTrip;
using testing::sendLine;

namespace {

using Millis = std::chrono::milliseconds;

class FakeProbe : public DialogProbe {
 public:
  std::optional<DialogInfo> current() override {
    const std::scoped_lock lock(mutex_);
    return shown_;
  }
  void show(const std::string& title) {
    const std::scoped_lock lock(mutex_);
    shown_ = DialogInfo{title};
  }
  void hide() {
    const std::scoped_lock lock(mutex_);
    shown_.reset();
  }

 private:
  std::mutex mutex_;
  std::optional<DialogInfo> shown_;
};

TEST(the_tracker_reports_nothing_without_a_running_call_or_a_probe) {
  FakeProbe probe;
  probe.show("Select LUT");
  DialogTracker tracker(&probe);
  const SteadyClock::time_point t0 = SteadyClock::now();
  CHECK(!tracker.observe(false, t0));
  DialogTracker none(nullptr);
  CHECK(!none.observe(true, t0));
}

TEST(the_tracker_counts_from_the_first_sighting_and_restarts_on_a_new_title_or_a_gap) {
  FakeProbe probe;
  DialogTracker tracker(&probe);
  const SteadyClock::time_point t0 = SteadyClock::now();
  CHECK(!tracker.observe(true, t0));
  probe.show("Select LUT");
  const std::optional<DialogReport> first = tracker.observe(true, t0 + Millis(10));
  CHECK(first.has_value());
  CHECK_EQ(first ? first->title : std::string(), std::string("Select LUT"));
  const std::optional<DialogReport> later = tracker.observe(true, t0 + Millis(1510));
  CHECK(later.has_value() && later->sinceMs >= 1499 && later->sinceMs <= 1501);
  probe.show("Numbers");
  const std::optional<DialogReport> next = tracker.observe(true, t0 + Millis(2000));
  CHECK(next.has_value());
  CHECK_EQ(next ? next->title : std::string(), std::string("Numbers"));
  CHECK(next.has_value() && next->sinceMs < 1);
  probe.hide();
  CHECK(!tracker.observe(true, t0 + Millis(2100)));
  probe.show("Numbers");
  const std::optional<DialogReport> restarted = tracker.observe(true, t0 + Millis(2200));
  CHECK(restarted.has_value() && restarted->sinceMs < 1);
}

JsonValue pingOf(const Server& server, net::Handle control) {
  const std::string line = R"({"id":"d","token":")" + server.token() + R"(","op":"ping_direct"})";
  return member(parsedReply(roundTrip(control, line)), "result");
}

TEST(ping_direct_names_the_dialog_only_while_a_host_call_is_running) {
  FakeProbe probe;
  probe.show("Select LUT");
  ServerConfig config;
  config.dialogProbe = &probe;
  Server server(config);
  std::string error;
  CHECK(server.start(error));
  const net::Handle control = connectTo(server.port());
  CHECK(member(pingOf(server, control), "waitingOnDialog").isNull());

  std::atomic<bool> inside{false};
  std::atomic<bool> release{false};
  std::thread mainThread([&] {
    while (!server.hasPending()) std::this_thread::sleep_for(Millis(1));
    server.drain(
        [&](const Request&, double) {
          inside.store(true);
          while (!release.load()) std::this_thread::sleep_for(Millis(1));
          return std::string(R"({"ok":true})");
        },
        1000);
  });
  const net::Handle command = connectTo(server.port());
  sendLine(command,
           R"({"id":"c","token":")" + server.token() + R"(","op":"host_call","entry":"aeApplyPlan","args":"{}"})");
  for (int i = 0; i < 500 && !inside.load(); ++i) std::this_thread::sleep_for(Millis(5));
  CHECK(inside.load());
  const JsonValue waiting = member(pingOf(server, control), "waitingOnDialog");
  CHECK_EQ(member(waiting, "title").text, std::string("Select LUT"));
  CHECK(member(waiting, "sinceMs").number >= 0);

  release.store(true);
  mainThread.join();
  for (int i = 0; i < 100 && !member(pingOf(server, control), "waitingOnDialog").isNull(); ++i) {
    std::this_thread::sleep_for(Millis(5));
  }
  CHECK(member(pingOf(server, control), "waitingOnDialog").isNull());
  net::closeHandle(command);
  net::closeHandle(control);
  server.stop();
}

}

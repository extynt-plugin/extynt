// The LaunchAgent kickstart: the exact arguments, and a child that is waited for or killed.
#include <atomic>
#include <chrono>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

#include "launch_agent.h"
#include "testing.h"

using namespace extynt;

namespace {

void waitDone(const std::atomic<bool>& done) {
  for (int i = 0; i < 500 && !done.load(); ++i) std::this_thread::sleep_for(std::chrono::milliseconds(10));
}

TEST(kickstart_arguments_name_the_gui_domain_of_the_user_and_never_restart) {
  const std::vector<std::string> expected = {"launchctl", "kickstart", "gui/501/com.extynt.sidecar"};
  CHECK(kickstartArguments(501, kSidecarLaunchLabel) == expected);
  CHECK_EQ(kickstartArguments(0, "x").back(), std::string("gui/0/x"));
}

TEST(a_child_that_exits_is_reported_with_its_status) {
  Kickstart kickstart;
  KickstartResult seen;
  std::atomic<bool> done{false};
  kickstart.start("/usr/bin/true", {"true"}, [&](const KickstartResult& result) {
    seen = result;
    done.store(true);
  });
  waitDone(done);
  kickstart.join();
  CHECK(done.load());
  CHECK(seen.spawned);
  CHECK(!seen.timedOut);
  CHECK_EQ(seen.exitCode, 0);

  Kickstart failing;
  KickstartResult failed;
  std::atomic<bool> failedDone{false};
  failing.start("/usr/bin/false", {"false"}, [&](const KickstartResult& result) {
    failed = result;
    failedDone.store(true);
  });
  waitDone(failedDone);
  failing.join();
  CHECK_EQ(failed.exitCode, 1);
}

TEST(a_child_that_outlives_the_timeout_is_killed) {
  Kickstart kickstart(150);
  KickstartResult seen;
  const auto started = std::chrono::steady_clock::now();
  kickstart.start("/bin/sleep", {"sleep", "60"}, [&](const KickstartResult& result) { seen = result; });
  kickstart.join();
  CHECK(seen.spawned);
  CHECK(seen.timedOut);
  CHECK(std::chrono::steady_clock::now() - started < std::chrono::seconds(10));
}

TEST(join_cancels_a_running_child_at_once) {
  Kickstart kickstart;
  KickstartResult seen;
  kickstart.start("/bin/sleep", {"sleep", "60"}, [&](const KickstartResult& result) { seen = result; });
  const auto started = std::chrono::steady_clock::now();
  kickstart.join();
  CHECK(std::chrono::steady_clock::now() - started < std::chrono::seconds(3));
  CHECK(seen.timedOut);
  kickstart.join();
}

TEST(a_program_that_cannot_be_spawned_reports_why) {
  Kickstart kickstart;
  KickstartResult seen;
  kickstart.start("/nonexistent/launchctl", {"launchctl"}, [&](const KickstartResult& result) { seen = result; });
  kickstart.join();
  CHECK(!seen.spawned);
  CHECK(!seen.error.empty());
}

TEST(a_callback_that_throws_does_not_end_the_process_and_is_told_once_more) {
  Kickstart kickstart;
  std::atomic<int> calls{0};
  KickstartResult second;
  kickstart.start("/usr/bin/true", {"true"}, [&](const KickstartResult& result) {
    if (calls.fetch_add(1) == 0) throw std::runtime_error("callback failed");
    second = result;
  });
  for (int i = 0; i < 500 && calls.load() < 2; ++i) std::this_thread::sleep_for(std::chrono::milliseconds(10));
  kickstart.join();
  CHECK_EQ(calls.load(), 2);
  CHECK(!second.spawned);
  CHECK_EQ(second.error, std::string("kickstart threw"));
}

}

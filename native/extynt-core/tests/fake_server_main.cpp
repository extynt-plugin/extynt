// Serves the fake scene over the real server so the Node tool (tools/native-spike) can be exercised on
// Linux: extynt_fake_server <discovery-file>. Stops on SIGINT/SIGTERM.
#include <csignal>

#include <atomic>
#include <chrono>
#include <cstdio>
#include <exception>
#include <iostream>
#include <string>
#include <thread>

#include "fake_host.h"
#include "idle_turn.h"
#include "server.h"
#include "timing.h"
#include "watch.h"

namespace {

void report(const char* what) noexcept {
  static_cast<void>(std::fputs("fake server failed: ", stderr));
  static_cast<void>(std::fputs(what, stderr));
  static_cast<void>(std::fputs("\n", stderr));
}

int serve(const char* discoveryPath) {
  sigset_t signals{};
  sigemptyset(&signals);
  sigaddset(&signals, SIGINT);
  sigaddset(&signals, SIGTERM);
  if (pthread_sigmask(SIG_BLOCK, &signals, nullptr) != 0) return 1;
  fake::Host host = fake::makeScene();
  extynt::ServerConfig config;
  config.discoveryPath = discoveryPath;
  config.info.pluginVersion = "fake";
  config.info.aeVersion = "fake-host";
  config.info.arch = "fake";
  extynt::Server server(config);
  std::string error;
  if (!server.start(error)) {
    std::cerr << "start failed: " << error << "\n";
    return 1;
  }
  std::cout << "listening on " << server.port() << "\n" << std::flush;
  std::atomic<bool> stop{false};
  std::thread waiter([&signals, &stop] {
    int received = 0;
    sigwait(&signals, &received);
    stop.store(true);
  });
  extynt::WatchTracker watch;
  extynt::IdleTurn turn(server, host, watch);
  while (!stop.load()) {
    turn.run(extynt::SteadyClock::now());
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  waiter.join();
  server.stop();
  return 0;
}

}

int main(int argc, char** argv) {
  if (argc < 2) {
    std::cerr << "usage: extynt_fake_server <discovery-file>\n";
    return 2;
  }
  try {
    return serve(argv[1]);
  } catch (const std::exception& error) {
    report(error.what());
  } catch (...) {
    report("unknown exception");
  }
  return 1;
}

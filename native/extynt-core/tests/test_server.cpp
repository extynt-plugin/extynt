// Tests for the sidecar-facing socket server: framing, dispatch, errors and shutdown.
#include <sys/stat.h>
#include <unistd.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <fstream>
#include <ios>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include "discovery.h"
#include "executor.h"
#include "fake_host.h"
#include "json_probe.h"
#include "net.h"
#include "request.h"
#include "server.h"
#include "socket_helpers.h"
#include "temp_dir.h"
#include "testing.h"

using namespace extynt;

namespace {

class FakeMainThread {
 public:
  FakeMainThread(Server& server, fake::Host& host, ServerInfo info) : server_(server), host_(host) {
    exec_.info = std::move(info);
    thread_ = std::thread([this] {
      while (!stop_.load()) {
        std::unique_lock<std::mutex> lock(mutex_);
        wake_.wait_for(lock, std::chrono::milliseconds(200), [this] { return poke_ || stop_.load(); });
        poke_ = false;
        lock.unlock();
        if (!server_.hasPending()) continue;
        server_.drain([this](const Request& request,
                             double queuedMs) { return executeRequest(request, host_, exec_.context(), queuedMs); },
                      8.0);
      }
    });
  }
  FakeMainThread(const FakeMainThread&) = delete;
  FakeMainThread& operator=(const FakeMainThread&) = delete;
  FakeMainThread(FakeMainThread&&) = delete;
  FakeMainThread& operator=(FakeMainThread&&) = delete;
  ~FakeMainThread() {
    stop_.store(true);
    wake_.notify_all();
    thread_.join();
  }
  void poke() {
    {
      const std::scoped_lock lock(mutex_);
      poke_ = true;
    }
    wake_.notify_all();
  }

 private:
  Server& server_;
  fake::Host& host_;
  fake::Exec exec_;
  std::atomic<bool> stop_{false};
  std::mutex mutex_;
  std::condition_variable wake_;
  bool poke_ = false;
  std::thread thread_;
};

using testing::connectTo;
using testing::parsedReply;
using testing::roundTrip;

std::string readFileText(const std::string& path) {
  const std::ifstream file(path);
  std::stringstream buffer;
  buffer << file.rdbuf();
  return buffer.str();
}

std::string tempPath() {
  return (testing::makeTempDir("extynt-test") / "Library/Application Support/extynt/native.json").string();
}

void checkRejections(const net::Handle fd) {
  const JsonValue denied = parsedReply(roundTrip(fd, R"({"id":"a","op":"ping"})"));
  CHECK(denied.find("ok")->boolean == false);
  CHECK_EQ(denied.find("error")->find("code")->text, std::string("UNAUTHORIZED"));
  const JsonValue wrong = parsedReply(roundTrip(fd, R"({"id":"a","token":"nope","op":"ping_direct"})"));
  CHECK_EQ(wrong.find("error")->find("code")->text, std::string("UNAUTHORIZED"));
  const JsonValue garbage = parsedReply(roundTrip(fd, "this is not json"));
  CHECK_EQ(garbage.find("error")->find("code")->text, std::string("BAD_JSON"));
}

void checkDiscoveryFile(const std::string& path, const Server& server) {
  const JsonValue discovery = parsedReply(readFileText(path));
  CHECK_EQ(static_cast<int>(discovery.find("port")->number), server.port());
  CHECK_EQ(discovery.find("token")->text, server.token());
  CHECK_EQ(discovery.find("pid")->number, static_cast<double>(::getpid()));
  CHECK_EQ(discovery.find("aeVersion")->text, std::string("26.5-test"));
  CHECK_EQ(discovery.find("pluginVersion")->text, std::string("0.1.0-test"));
  CHECK_EQ(server.token().size(), size_t(64));
  struct stat info{};
  CHECK(::stat(path.c_str(), &info) == 0);
  CHECK_EQ(static_cast<int>(info.st_mode & 0777), 0600);
}

void checkAuthorizedOps(const net::Handle fd, const std::string& token) {
  const JsonValue direct = parsedReply(roundTrip(fd, R"({"id":"d","token":")" + token + R"(","op":"ping_direct"})"));
  CHECK(direct.find("ok")->boolean);
  CHECK(direct.find("result")->find("mainThread")->boolean == false);
  const JsonValue ping = parsedReply(roundTrip(fd, R"({"id":"p","token":")" + token + R"(","op":"ping"})"));
  CHECK(ping.find("ok")->boolean);
  CHECK(ping.find("result")->find("mainThread")->boolean);
  CHECK_EQ(ping.find("result")->find("pid")->number, static_cast<double>(::getpid()));
  CHECK_EQ(ping.find("timing")->find("dispatchedBy")->text, std::string("idle"));
  CHECK_EQ(ping.find("id")->text, std::string("p"));
  CHECK(ping.find("timing")->find("queuedMs")->number >= 0);

  for (int i = 0; i < 3; ++i) {
    const JsonValue read =
        parsedReply(roundTrip(fd, R"({"id":"r","token":")" + token + R"(","op":"read_project","detail":"full"})"));
    CHECK(read.find("ok")->boolean);
    CHECK_EQ(read.find("result")->find("compositions")->items.size(), size_t(2));
  }
  const JsonValue hash = parsedReply(roundTrip(fd, R"({"id":"h","token":")" + token + R"(","op":"hash_project"})"));
  CHECK_EQ(hash.find("result")->find("projectHash")->text.size(), size_t(32));
}

TEST(server_end_to_end) {
  fake::Host host = fake::makeScene();
  ServerConfig config;
  config.discoveryPath = tempPath();
  config.info.pluginVersion = "0.1.0-test";
  config.info.aeVersion = "26.5-test";
  std::unique_ptr<FakeMainThread> mainThread;
  config.wakeMainThread = [&mainThread] {
    if (mainThread) mainThread->poke();
  };
  Server server(config);
  std::string error;
  CHECK(server.start(error));
  mainThread = std::make_unique<FakeMainThread>(server, host, server.info());

  checkDiscoveryFile(config.discoveryPath, server);
  struct stat info{};

  const net::Handle fd = connectTo(server.port());
  const std::string token = server.token();

  checkRejections(fd);

  checkAuthorizedOps(fd, token);

  const net::Handle second = connectTo(server.port());
  const JsonValue other = parsedReply(roundTrip(second, R"({"id":"s","token":")" + token + R"(","op":"ping"})"));
  CHECK(other.find("ok")->boolean);
  net::closeHandle(second);

  net::closeHandle(fd);
  mainThread.reset();
  server.stop();
  CHECK(::stat(config.discoveryPath.c_str(), &info) != 0);
  server.stop();
}

TEST(server_joins_finished_connection_threads_on_accept) {
  const ServerConfig config;
  Server server(config);
  std::string error;
  CHECK(server.start(error));
  const std::string ping = R"({"id":"d","token":")" + server.token() + R"(","op":"ping_direct"})";
  for (int i = 0; i < 20; ++i) {
    const net::Handle fd = connectTo(server.port());
    CHECK(parsedReply(roundTrip(fd, ping)).find("ok")->boolean);
    net::closeHandle(fd);
  }
  std::this_thread::sleep_for(std::chrono::milliseconds(200));
  const net::Handle last = connectTo(server.port());
  CHECK(parsedReply(roundTrip(last, ping)).find("ok")->boolean);
  CHECK(server.connectionThreadCount() <= size_t(3));
  net::closeHandle(last);
  server.stop();
  CHECK_EQ(server.connectionThreadCount(), size_t(0));
}

TEST(server_stop_fails_queued_requests_instead_of_hanging) {
  ServerConfig config;
  config.info.pluginVersion = "t";
  Server server(config);
  std::string error;
  CHECK(server.start(error));
  const net::Handle fd = connectTo(server.port());
  const std::string line = R"({"id":"q","token":")" + server.token() + "\",\"op\":\"ping\"}\n";
  CHECK(net::sendAll(fd, line.data(), line.size()));
  for (int i = 0; i < 100 && !server.hasPending(); ++i) std::this_thread::sleep_for(std::chrono::milliseconds(10));
  CHECK(server.hasPending());
  std::thread stopper([&server] { server.stop(); });
  std::string reply;
  char c = 0;
  while (net::receiveSome(fd, &c, 1) == 1 && c != '\n') reply += c;
  stopper.join();
  net::closeHandle(fd);
  CHECK(reply.find("SHUTTING_DOWN") != std::string::npos);
}

TEST(server_drain_returns_immediately_when_idle) {
  const ServerConfig config;
  Server server(config);
  CHECK(!server.hasPending());
  const size_t ran = server.drain([](const Request&, double) { return std::string("{}"); }, 8.0);
  CHECK_EQ(ran, size_t(0));
}

TEST(discovery_remove_keeps_a_newer_instance_file) {
  const std::string path = tempPath();
  DiscoveryRecord ours;
  ours.port = 1;
  ours.token = "tokenA";
  DiscoveryRecord theirs = ours;
  theirs.token = "tokenB";
  std::string error;
  CHECK(writeDiscoveryFile(path, theirs, error));
  removeDiscoveryFile(path, ours.token);
  struct stat info{};
  CHECK(::stat(path.c_str(), &info) == 0);
  removeDiscoveryFile(path, theirs.token);
  CHECK(::stat(path.c_str(), &info) != 0);
}

TEST(discovery_write_does_not_touch_another_writers_temp_file) {
  const std::string path = tempPath();
  const std::string otherTemp = path + ".tmp";
  std::string error;
  CHECK(ensureParentDirectories(path, error));
  {
    std::ofstream other(otherTemp, std::ios::binary);
    other << "another instance's pending record";
  }
  DiscoveryRecord ours;
  ours.port = 1;
  ours.token = "tokenA";
  CHECK(writeDiscoveryFile(path, ours, error));
  CHECK_EQ(readFileText(otherTemp), std::string("another instance's pending record"));
  removeDiscoveryFile(path, ours.token);
}

}

// Localhost request server. Socket threads parse and authenticate requests and queue them;
// the host's main thread drains the queue (from AEGP's idle hook) and hands responses back.
// No SDK includes: it is unit-tested on Linux with a stand-in for the main thread.
#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <condition_variable>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <set>
#include <string>
#include <thread>
#include <vector>

#include "dialog_probe.h"
#include "direct_status.h"
#include "event_hub.h"
#include "executor.h"
#include "net.h"
#include "request.h"

namespace extynt {

// How a Server is built. `discoveryPath` is empty to write no discovery file.
struct ServerConfig {
  std::string discoveryPath;
  ServerInfo info;
  // Called on a socket thread after a request is queued. The AE adapter wires this to
  // AEGP_CauseIdleRoutinesToBeCalled (the one call documented as safe off the main thread).
  std::function<void()> wakeMainThread;
  // Looks for a window After Effects opened while a host call runs (core/dialog_probe.h); not owned, outlives the
  // server.
  DialogProbe* dialogProbe = nullptr;
  // True in the headless catalogue engine (core/host_mode.h). It never touches a user project, so only the requests of
  // core/host_mode.h engineRequestAllowed pass and everything else is refused with ENGINE_REFUSED. Outside the engine a
  // probe that asks to be treated as the engine is refused (ENGINE_ONLY).
  bool engine = false;
};

class Server {
 public:
  explicit Server(ServerConfig config);
  ~Server();
  Server(const Server&) = delete;
  Server& operator=(const Server&) = delete;
  Server(Server&&) = delete;
  Server& operator=(Server&&) = delete;

  bool start(std::string& error);
  // Idempotent. Closes sockets, fails queued requests, joins threads, removes the discovery file.
  void stop();

  [[nodiscard]] int port() const { return port_; }
  [[nodiscard]] const std::string& token() const { return token_; }
  // The info the plugin answers pings with, including the process id start() filled in (the copy
  // handed to the constructor is stale: the server owns its own).
  [[nodiscard]] const ServerInfo& info() const { return config_.info; }

  // Cheap check for the idle hook: no lock, no allocation.
  [[nodiscard]] bool hasPending() const { return pending_.load(std::memory_order_acquire) > 0; }

  // Main thread, every idle hook call (before any early-out): what ping_direct's idleAgeMs measures.
  void noteIdleTick() noexcept;
  // Watch subscriptions: lock-free check for the idle hook, and the cadence the subscribers asked for (the smallest).
  // Connection threads not yet joined: live ones plus finished ones awaiting the next accept (or stop).
  [[nodiscard]] std::size_t connectionThreadCount() const;
  [[nodiscard]] bool hasWatchers() const { return watchers_.load(std::memory_order_acquire) > 0; }
  [[nodiscard]] int watchIntervalMs() const { return hub_.intervalMs(); }
  [[nodiscard]] int watchStillMs() const { return hub_.stillMs(); }
  // True once after a subscriber arrived: the next sample must be a full `change` with reason ["initial"].
  bool takeInitialRequest() { return initialRequested_.exchange(false); }
  [[nodiscard]] bool initialRequested() const { return initialRequested_.load(); }
  // Hands one event line (no trailing newline) to every subscriber's queue. Never touches a socket.
  void publish(const std::string& line) { hub_.publish(line); }
  // What ping_direct answers; callable from any thread.
  [[nodiscard]] DirectStatus directStatus() const;
  // The library host_call last resolved; written on the main thread, read here for ping_direct.
  LibraryStatus& libraryStatus() { return library_; }

  using Executor = std::function<std::string(const Request&, double queuedMs)>;
  // Main thread only. Runs queued requests until the queue is empty or `budgetMs` has passed
  // (at least one request always runs). Returns how many ran.
  size_t drain(const Executor& executor, double budgetMs);

 private:
  struct Job {
    Request request;
    SteadyClock::time_point enqueued;
    std::mutex mutex;
    std::condition_variable done;
    bool finished = false;
    std::string response;
  };

  enum class LineOutcome : uint8_t { Continue, Close, Watch };

  // A socket thread and the flag it raises as its last act, so the acceptor can join it as soon as it is done.
  struct Connection {
    std::thread thread;
    std::shared_ptr<std::atomic<bool>> finished;
  };

  void acceptLoop();
  void pruneFinishedConnections();
  void serveConnection(net::Handle client);
  LineOutcome handleBufferedLines(net::Handle client, std::string& buffer, int& subscriberId);
  struct Refusal {
    std::string code;
    std::string message;
  };

  [[nodiscard]] bool refusedByEngine(const Request& request) const;
  [[nodiscard]] std::optional<Refusal> refusalFor(const Request& request) const;
  static LineOutcome sendLine(net::Handle client, std::string response);
  void failQueuedJobs();
  void joinConnections();
  LineOutcome handleLine(net::Handle client, const std::string& line, int& subscriberId);
  LineOutcome startWatch(net::Handle client, const Request& request, int& subscriberId);
  void serveWatch(net::Handle client, int subscriberId);
  std::string dispatch(const Request& request);
  static void finishJob(Job& job, std::string response);
  static void failAbandoned(Job& job) noexcept;

  ServerConfig config_;
  net::Handle listener_ = net::kInvalidHandle;
  int port_ = 0;
  std::string token_;
  std::atomic<bool> stopping_{false};
  bool started_ = false;

  EventHub hub_;
  LibraryStatus library_;
  mutable DialogTracker dialogs_;
  std::atomic<bool> callRunning_{false};
  std::atomic<int> watchers_{0};
  std::atomic<bool> initialRequested_{false};
  std::atomic<int64_t> lastIdleNs_{0};
  std::atomic<uint64_t> idleTicks_{0};

  mutable std::mutex queueMutex_;
  std::deque<std::shared_ptr<Job>> queue_;
  std::atomic<int> pending_{0};

  std::thread acceptor_;
  mutable std::mutex connectionsMutex_;
  std::set<net::Handle> clients_;
  std::vector<Connection> connectionThreads_;
};

}

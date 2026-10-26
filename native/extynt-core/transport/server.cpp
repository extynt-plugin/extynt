// The loopback server: accepts connections, parses request lines, runs main-thread jobs and answers.
#include "server.h"

#include <optional>
#include <string>
#include <cstddef>
#include <utility>
#include <deque>
#include <memory>
#include <mutex>
#include <vector>
#include <array>
#include <algorithm>
#include <atomic>
#include <chrono>

#include "direct_status.h"
#include "discovery.h"
#include "discovery_platform.h"
#include "executor.h"
#include "host_mode.h"
#include "net.h"
#include "timing.h"
#include "request.h"
#include "request_id.h"

namespace extynt {

namespace {

constexpr int kWatchSendTimeoutMs = 500;
constexpr int kWatchPollMs = 100;

bool mayOpenWindow(Op op) { return op == Op::HostCall || op == Op::Batch; }

bool tokensEqual(const std::string& a, const std::string& b) {
  if (a.size() != b.size()) return false;
  unsigned char difference = 0;
  for (size_t i = 0; i < a.size(); ++i) difference |= static_cast<unsigned char>(a[i] ^ b[i]);
  return difference == 0;
}

}

bool Server::refusedByEngine(const Request& request) const { return config_.engine && !engineRequestAllowed(request); }

Server::Server(ServerConfig config) : config_(std::move(config)), dialogs_(config_.dialogProbe) {}

Server::~Server() {
  try {
    stop();
  } catch (...) {
    stopping_.store(true);
  }
}

bool Server::start(std::string& error) {
  if (started_) return true;
  if (!makeToken(token_)) {
    error = "could not read OS entropy for the token";
    return false;
  }
  if (!net::listenLoopback(listener_, port_, error)) return false;
  DiscoveryRecord record;
  record.port = port_;
  record.token = token_;
  record.pid = platform::currentProcessId();
  record.aeVersion = config_.info.aeVersion;
  record.pluginVersion = config_.info.pluginVersion;
  config_.info.pid = record.pid;
  if (!config_.discoveryPath.empty() && !writeDiscoveryFile(config_.discoveryPath, record, error)) {
    net::closeHandle(listener_);
    listener_ = net::kInvalidHandle;
    return false;
  }
  started_ = true;
  acceptor_ = std::thread([this] { acceptLoop(); });
  return true;
}

void Server::failQueuedJobs() {
  std::deque<std::shared_ptr<Job>> abandoned;
  {
    const std::scoped_lock lock(queueMutex_);
    abandoned.swap(queue_);
    pending_.store(0);
  }
  for (auto& job : abandoned) failAbandoned(*job);
}

void Server::joinConnections() {
  std::vector<Connection> connections;
  {
    const std::scoped_lock lock(connectionsMutex_);
    connections.swap(connectionThreads_);
  }
  for (Connection& connection : connections) {
    if (connection.thread.joinable()) connection.thread.join();
  }
}

void Server::stop() {
  if (!started_) return;
  started_ = false;
  stopping_.store(true);
  if (!config_.discoveryPath.empty()) removeDiscoveryFile(config_.discoveryPath, token_);
  failQueuedJobs();
  if (acceptor_.joinable()) acceptor_.join();
  hub_.closeAll();
  {
    const std::scoped_lock lock(connectionsMutex_);
    for (const net::Handle client : clients_) net::shutdownRead(client);
  }
  if (listener_ != net::kInvalidHandle) {
    net::closeHandle(listener_);
    listener_ = net::kInvalidHandle;
  }
  joinConnections();
}

std::size_t Server::connectionThreadCount() const {
  const std::scoped_lock lock(connectionsMutex_);
  return connectionThreads_.size();
}

void Server::pruneFinishedConnections() {
  const auto done = [](Connection& connection) {
    if (!connection.finished->load(std::memory_order_acquire)) return false;
    if (connection.thread.joinable()) connection.thread.join();
    return true;
  };
  connectionThreads_.erase(std::remove_if(connectionThreads_.begin(), connectionThreads_.end(), done),
                           connectionThreads_.end());
}

void Server::acceptLoop() {
  while (!stopping_.load()) {
    bool timedOut = false;
    const net::Handle client = net::acceptClient(listener_, 100, timedOut);
    if (client == net::kInvalidHandle) {
      if (timedOut) continue;
      break;
    }
    const std::scoped_lock lock(connectionsMutex_);
    if (stopping_.load()) {
      net::closeHandle(client);
      break;
    }
    pruneFinishedConnections();
    clients_.insert(client);
    auto finished = std::make_shared<std::atomic<bool>>(false);
    connectionThreads_.push_back({std::thread([this, client, finished] {
                                    serveConnection(client);
                                    finished->store(true, std::memory_order_release);
                                  }),
                                  finished});
  }
}

void Server::finishJob(Job& job, std::string response) {
  {
    const std::scoped_lock lock(job.mutex);
    if (job.finished) return;
    job.response = std::move(response);
    job.finished = true;
  }
  job.done.notify_all();
}

void Server::failAbandoned(Job& job) noexcept {
  try {
    finishJob(job, errorResponse(job.request.id, job.request.opName, "SHUTTING_DOWN", "After Effects is closing"));
  } catch (...) {
    finishJob(job, std::string());
  }
}

std::string Server::dispatch(const Request& request) {
  auto job = std::make_shared<Job>();
  job->request = request;
  job->enqueued = SteadyClock::now();
  {
    const std::scoped_lock lock(queueMutex_);
    if (stopping_.load()) return errorResponse(request.id, request.opName, "SHUTTING_DOWN", "After Effects is closing");
    queue_.push_back(job);
    pending_.fetch_add(1, std::memory_order_release);
  }
  if (config_.wakeMainThread) config_.wakeMainThread();
  std::unique_lock<std::mutex> lock(job->mutex);
  job->done.wait(lock, [&] { return job->finished; });
  return job->response;
}

Server::LineOutcome Server::startWatch(net::Handle client, const Request& request, int& subscriberId) {
  subscriberId = hub_.subscribe(request.watchIntervalMs, request.watchStillMs);
  watchers_.fetch_add(1, std::memory_order_release);
  initialRequested_.store(true);
  std::string response =
      socketResponse(request, R"({"subscribed":true,"intervalMs":)" + std::to_string(request.watchIntervalMs) +
                                  R"(,"stillMs":)" + std::to_string(request.watchStillMs) + "}");
  response += '\n';
  if (net::sendAll(client, response.data(), response.size())) return LineOutcome::Watch;
  hub_.unsubscribe(subscriberId);
  watchers_.fetch_sub(1, std::memory_order_release);
  return LineOutcome::Close;
}

std::optional<Server::Refusal> Server::refusalFor(const Request& request) const {
  if (!tokensEqual(request.token, token_)) return Refusal{"UNAUTHORIZED", "missing or wrong token"};
  if (!config_.engine && claimsEngineProbe(request)) {
    return Refusal{"ENGINE_ONLY", "this probe replaces projects and runs only in the catalogue engine"};
  }
  if (refusedByEngine(request)) {
    return Refusal{"ENGINE_REFUSED", "the catalogue engine answers catalogue requests only"};
  }
  return std::nullopt;
}

Server::LineOutcome Server::sendLine(net::Handle client, std::string response) {
  response += '\n';
  return net::sendAll(client, response.data(), response.size()) ? LineOutcome::Continue : LineOutcome::Close;
}

Server::LineOutcome Server::handleLine(net::Handle client, const std::string& line, int& subscriberId) {
  const ParsedRequest parsed = parseRequest(line);
  const Request& request = parsed.request;
  if (!parsed.ok)
    return sendLine(client, errorResponse(request.id, request.opName, parsed.errorCode, parsed.errorMessage));
  if (const std::optional<Refusal> refusal = refusalFor(request)) {
    return sendLine(client, errorResponse(request.id, request.opName, refusal->code, refusal->message));
  }
  if (request.op == Op::Watch) return startWatch(client, request, subscriberId);
  if (request.op == Op::PingDirect) return sendLine(client, directPingResponse(request, config_.info, directStatus()));
  return sendLine(client, dispatch(request));
}

void Server::serveWatch(net::Handle client, int subscriberId) {
  net::setSendTimeout(client, kWatchSendTimeoutMs);
  std::string line;
  for (;;) {
    if (hub_.waitNext(subscriberId, line, kWatchPollMs)) {
      line += '\n';
      if (!net::sendAll(client, line.data(), line.size())) break;
    } else if (hub_.closed()) {
      break;
    }
    if (net::peerClosed(client)) break;
  }
  hub_.unsubscribe(subscriberId);
  watchers_.fetch_sub(1, std::memory_order_release);
}

void Server::noteIdleTick() noexcept {
  const auto now = SteadyClock::now().time_since_epoch();
  lastIdleNs_.store(std::chrono::duration_cast<std::chrono::nanoseconds>(now).count(), std::memory_order_release);
  idleTicks_.fetch_add(1, std::memory_order_release);
}

DirectStatus Server::directStatus() const {
  DirectStatus status;
  status.idleTicks = idleTicks_.load(std::memory_order_acquire);
  if (status.idleTicks > 0) {
    const auto last = SteadyClock::time_point(std::chrono::nanoseconds(lastIdleNs_.load(std::memory_order_acquire)));
    status.idleAgeMs = std::max(0.0, elapsedMs(last, SteadyClock::now()));
  }
  {
    const std::scoped_lock lock(queueMutex_);
    status.queueDepth = queue_.size();
    if (!queue_.empty()) status.oldestQueuedMs = elapsedMs(queue_.front()->enqueued, SteadyClock::now());
  }
  status.watchers = watchers_.load(std::memory_order_acquire);
  status.library = library_.get();
  status.dialog = dialogs_.observe(callRunning_.load(std::memory_order_acquire), SteadyClock::now());
  return status;
}

Server::LineOutcome Server::handleBufferedLines(net::Handle client, std::string& buffer, int& subscriberId) {
  size_t newline = 0;
  while ((newline = buffer.find('\n')) != std::string::npos) {
    std::string line = buffer.substr(0, newline);
    buffer.erase(0, newline + 1);
    if (!line.empty() && line.back() == '\r') line.pop_back();
    if (line.empty()) continue;
    const LineOutcome outcome = handleLine(client, line, subscriberId);
    if (outcome != LineOutcome::Continue) return outcome;
  }
  return LineOutcome::Continue;
}

void Server::serveConnection(net::Handle client) {
  std::string buffer;
  std::array<char, 16384> chunk{};
  int subscriberId = 0;
  LineOutcome outcome = LineOutcome::Continue;
  while (outcome == LineOutcome::Continue && !stopping_.load()) {
    const long n = net::receiveSome(client, chunk.data(), chunk.size());
    if (n <= 0) break;
    buffer.append(chunk.data(), static_cast<size_t>(n));
    outcome = handleBufferedLines(client, buffer, subscriberId);
    if (outcome == LineOutcome::Continue && buffer.size() > kMaxRequestBytes) {
      std::string response =
          errorResponse(recoverRequestId(buffer), "", "REQUEST_TOO_LARGE", "request line exceeds 16 MiB") + "\n";
      net::sendAll(client, response.data(), response.size());
      break;
    }
  }
  {
    const std::scoped_lock lock(connectionsMutex_);
    clients_.erase(client);
  }
  if (outcome == LineOutcome::Watch) serveWatch(client, subscriberId);
  net::closeHandle(client);
}

size_t Server::drain(const Executor& executor, double budgetMs) {
  const SteadyClock::time_point start = SteadyClock::now();
  size_t ran = 0;
  for (;;) {
    std::shared_ptr<Job> job;
    {
      const std::scoped_lock lock(queueMutex_);
      if (queue_.empty()) break;
      job = queue_.front();
      queue_.pop_front();
      pending_.fetch_sub(1, std::memory_order_release);
    }
    const double queuedMs = elapsedMs(job->enqueued, SteadyClock::now());
    std::string response;
    callRunning_.store(mayOpenWindow(job->request.op), std::memory_order_release);
    try {
      response = executor(job->request, queuedMs);
    } catch (...) {
      response = errorResponse(job->request.id, job->request.opName, "INTERNAL", "executor threw");
    }
    callRunning_.store(false, std::memory_order_release);
    finishJob(*job, std::move(response));
    ++ran;
    if (elapsedMs(start, SteadyClock::now()) >= budgetMs) break;
  }
  if (hasPending() && config_.wakeMainThread) config_.wakeMainThread();
  return ran;
}

}

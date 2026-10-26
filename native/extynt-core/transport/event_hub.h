// Fan-out of watch event lines to subscribers (docs/native/protocol.md, 4). `publish` only appends to bounded
// in-memory queues, so the main thread never touches a socket; each watch connection's thread waits on its own queue.
#pragma once

#include <condition_variable>
#include <cstddef>
#include <deque>
#include <map>
#include <mutex>
#include <string>

namespace extynt {

constexpr size_t kEventQueueLimit = 256;

class EventHub {
 public:
  // Registers a subscriber with its requested cadence; returns its id.
  int subscribe(int intervalMs, int stillMs);
  void unsubscribe(int id);
  // Queues `line` for every subscriber. A subscriber whose queue is full loses its oldest line and is sent one
  // `overflow` line (before the lines that follow) saying how many were dropped.
  void publish(const std::string& line);
  // Waits up to `timeoutMs` for the next line for `id`. False on timeout, or when the hub is closed and the queue is
  // empty.
  bool waitNext(int id, std::string& out, int timeoutMs);
  [[nodiscard]] size_t count() const;
  // The smallest cadence any subscriber asked for; the defaults' ceiling when there are none.
  [[nodiscard]] int intervalMs() const;
  [[nodiscard]] int stillMs() const;
  // Wakes every waiter; queued lines can still be taken, then waitNext returns false for good.
  void closeAll();
  [[nodiscard]] bool closed() const;

 private:
  struct Subscriber {
    int intervalMs = 0;
    int stillMs = 0;
    size_t dropped = 0;
    std::deque<std::string> lines;
  };

  mutable std::mutex mutex_;
  std::condition_variable wake_;
  std::map<int, Subscriber> subscribers_;
  int nextId_ = 1;
  bool closed_ = false;
};

}

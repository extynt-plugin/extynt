// Bounded per-subscriber queues of watch event lines, filled by publish and drained by each connection's thread.
#include "event_hub.h"

#include <algorithm>
#include <chrono>
#include <cstddef>
#include <mutex>
#include <string>
#include <utility>

#include "request.h"

namespace extynt {

int EventHub::subscribe(int intervalMs, int stillMs) {
  const std::scoped_lock lock(mutex_);
  const int id = nextId_++;
  Subscriber& subscriber = subscribers_[id];
  subscriber.intervalMs = intervalMs;
  subscriber.stillMs = stillMs;
  return id;
}

void EventHub::unsubscribe(int id) {
  const std::scoped_lock lock(mutex_);
  subscribers_.erase(id);
}

void EventHub::publish(const std::string& line) {
  {
    const std::scoped_lock lock(mutex_);
    for (auto& entry : subscribers_) {
      Subscriber& subscriber = entry.second;
      if (subscriber.lines.size() >= kEventQueueLimit) {
        subscriber.lines.pop_front();
        ++subscriber.dropped;
      }
      subscriber.lines.push_back(line);
    }
  }
  wake_.notify_all();
}

bool EventHub::waitNext(int id, std::string& out, int timeoutMs) {
  std::unique_lock<std::mutex> lock(mutex_);
  const auto ready = [this, id] {
    const auto found = subscribers_.find(id);
    return closed_ || found == subscribers_.end() || !found->second.lines.empty() || found->second.dropped > 0;
  };
  wake_.wait_for(lock, std::chrono::milliseconds(timeoutMs), ready);
  const auto found = subscribers_.find(id);
  if (found == subscribers_.end()) return false;
  Subscriber& subscriber = found->second;
  if (subscriber.dropped > 0) {
    out = R"({"event":"overflow","dropped":)" + std::to_string(subscriber.dropped) + "}";
    subscriber.dropped = 0;
    return true;
  }
  if (subscriber.lines.empty()) return false;
  out = std::move(subscriber.lines.front());
  subscriber.lines.pop_front();
  return true;
}

size_t EventHub::count() const {
  const std::scoped_lock lock(mutex_);
  return subscribers_.size();
}

int EventHub::intervalMs() const {
  const std::scoped_lock lock(mutex_);
  int value = kWatchIntervalMaxMs;
  for (const auto& entry : subscribers_) value = std::min(value, entry.second.intervalMs);
  return value;
}

int EventHub::stillMs() const {
  const std::scoped_lock lock(mutex_);
  int value = kWatchStillMaxMs;
  for (const auto& entry : subscribers_) value = std::min(value, entry.second.stillMs);
  return value;
}

void EventHub::closeAll() {
  {
    const std::scoped_lock lock(mutex_);
    closed_ = true;
  }
  wake_.notify_all();
}

bool EventHub::closed() const {
  const std::scoped_lock lock(mutex_);
  return closed_;
}

}

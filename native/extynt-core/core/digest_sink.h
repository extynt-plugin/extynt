// Buffered writer of plain values into a Hasher: the content digests of a property (key times, values, easing, text,
// markers, paths) feed hundreds of small fields, and this makes one hasher call per 512 bytes instead of one per field.
// The hasher takes the same digest for any chunking, so the buffer is invisible in the result.
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <algorithm>
#include <cstring>
#include <string_view>
#include <type_traits>

#include "hash128.h"

namespace extynt {

class DigestSink {
 public:
  explicit DigestSink(Hasher& hasher) : hasher_(&hasher) {}
  ~DigestSink() { flush(); }
  DigestSink(const DigestSink&) = delete;
  DigestSink& operator=(const DigestSink&) = delete;
  DigestSink(DigestSink&&) = delete;
  DigestSink& operator=(DigestSink&&) = delete;

  template <typename T>
  void put(const T& value) {
    putArray(&value, 1);
  }

  template <typename T>
  void putArray(const T* items, size_t count) {
    static_assert(std::is_trivially_copyable_v<T>, "a digest field is plain data");
    for (size_t done = 0; done < count;) {
      const size_t fit = (buffer_.size() - used_) / sizeof(T);
      if (fit == 0) {
        flush();
        continue;
      }
      const size_t take = std::min(fit, count - done);
      std::memcpy(buffer_.data() + used_, items + done, take * sizeof(T));
      used_ += take * sizeof(T);
      done += take;
    }
  }

  void putText(std::string_view text) { putArray(text.data(), text.size()); }

  void flush() {
    if (used_ == 0) return;
    hasher_->update(std::string_view(buffer_.data(), used_));
    used_ = 0;
  }

 private:
  Hasher* hasher_;
  std::array<char, 512> buffer_{};
  size_t used_ = 0;
};

}

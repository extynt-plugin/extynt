// 128-bit content hashing (XXH3-128, BSD-2, vendored in third_party/xxhash).
// Hex form is the canonical big-endian one: high 64 bits first, 32 lowercase hex digits.
// Not a cryptographic hash: it detects change and accidental collisions, not tampering.
#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <string_view>

namespace extynt {

struct Hash128 {
  uint64_t high = 0;
  uint64_t low = 0;
  [[nodiscard]] std::string hex() const;
  bool operator==(const Hash128& other) const { return high == other.high && low == other.low; }
  bool operator!=(const Hash128& other) const { return !(*this == other); }
};

// The digest of the text's bytes (any bytes, not only text).
Hash128 hashText(std::string_view text);

// Streaming hash. Feeding the same bytes in any chunking gives the same digest.
// Merkle nodes are built by feeding child digests with update(Hash128).
class Hasher {
 public:
  Hasher();
  ~Hasher();
  Hasher(const Hasher&) = delete;
  Hasher& operator=(const Hasher&) = delete;
  Hasher(Hasher&&) = delete;
  Hasher& operator=(Hasher&&) = delete;
  void update(std::string_view bytes);
  // Feeds the digest's 16 bytes, big-endian.
  void update(const Hash128& child);
  [[nodiscard]] Hash128 digest() const;
  // Starts a new digest on the same state, so a hot loop allocates nothing
  void reset();

 private:
  struct State;
  std::unique_ptr<State> state_;
};

}

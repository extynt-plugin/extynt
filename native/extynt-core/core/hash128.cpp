// XXH3-128 over bytes, strings and parts, the only file that includes xxhash.

#include "hash128.h"

#include <array>
#include <cstddef>
#include <memory>
#include <string>
#include <string_view>

#define XXH_INLINE_ALL
#include "xxhash.h"

namespace extynt {

namespace {

Hash128 fromXxh(const XXH128_hash_t& value) {
  Hash128 out;
  out.high = value.high64;
  out.low = value.low64;
  return out;
}

struct XxhStateDeleter {
  void operator()(XXH3_state_t* state) const { XXH3_freeState(state); }
};

}

std::string Hash128::hex() const {
  static constexpr std::string_view kDigits = "0123456789abcdef";
  std::string out(32, '0');
  for (unsigned i = 0; i < 16; ++i) {
    out[i] = kDigits[(high >> (60 - (4 * i))) & 15];
    out[16 + i] = kDigits[(low >> (60 - (4 * i))) & 15];
  }
  return out;
}

Hash128 hashText(std::string_view text) { return fromXxh(XXH3_128bits(text.data(), text.size())); }

struct Hasher::State {
  std::unique_ptr<XXH3_state_t, XxhStateDeleter> state{XXH3_createState()};
};

Hasher::Hasher() : state_(std::make_unique<State>()) { XXH3_128bits_reset(state_->state.get()); }

Hasher::~Hasher() = default;

void Hasher::update(std::string_view bytes) { XXH3_128bits_update(state_->state.get(), bytes.data(), bytes.size()); }

void Hasher::update(const Hash128& child) {
  std::array<char, 16> bytes{};
  for (size_t index = 0; index < 8; ++index) {
    const unsigned shift = 56U - (8U * static_cast<unsigned>(index));
    bytes.at(index) = static_cast<char>(child.high >> shift);
    bytes.at(index + 8) = static_cast<char>(child.low >> shift);
  }
  update(std::string_view(bytes.data(), bytes.size()));
}

void Hasher::reset() { XXH3_128bits_reset(state_->state.get()); }

Hash128 Hasher::digest() const { return fromXxh(XXH3_128bits_digest(state_->state.get())); }

}

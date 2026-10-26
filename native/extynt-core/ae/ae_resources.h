// Small RAII and handle helpers for the AEGP adapter. Header only, no SDK types.
#pragma once

#include <cstdint>
#include <cstring>
#include <type_traits>
#include <utility>

#include "ae_log.h"

namespace extynt::ae {

// Runs `release` when it goes out of scope: how an AEGP handle that this code owns is given back on every path,
// exceptions included. The release runs in a destructor, so nothing it throws may leave it.
template <typename Release>
class ScopeGuard {
 public:
  explicit ScopeGuard(Release release) : release_(std::move(release)) {}
  ScopeGuard(const ScopeGuard&) = delete;
  ScopeGuard& operator=(const ScopeGuard&) = delete;
  ScopeGuard(ScopeGuard&&) = delete;
  ScopeGuard& operator=(ScopeGuard&&) = delete;
  ~ScopeGuard() {
    try {
      release_();
    } catch (...) {
      logDroppedException("scope guard");
    }
  }

 private:
  Release release_;
};

}

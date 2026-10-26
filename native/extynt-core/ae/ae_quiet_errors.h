// AE error dialogs quieted for a scope, so a failure shows in the caller's answer instead.
#pragma once

#include "ae_sdk.h"

namespace extynt::ae {

// AE's error dialogs are quieted while a request runs; the failure shows in the answer instead.
class QuietErrors {
 public:
  explicit QuietErrors(const AEGP_UtilitySuite4* utility)
      : utility_(utility), quiet_(utility != nullptr && utility->AEGP_StartQuietErrors(&state_) == A_Err_NONE) {}
  ~QuietErrors() {
    if (quiet_) utility_->AEGP_EndQuietErrors(FALSE, &state_);
  }
  QuietErrors(const QuietErrors&) = delete;
  QuietErrors& operator=(const QuietErrors&) = delete;
  QuietErrors(QuietErrors&&) = delete;
  QuietErrors& operator=(QuietErrors&&) = delete;

 private:
  const AEGP_UtilitySuite4* utility_;
  AEGP_ErrReportState state_{};
  bool quiet_;
};

}

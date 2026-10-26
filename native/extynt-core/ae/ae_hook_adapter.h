// AEGP hooks have fixed C signatures, several with six parameters. HookAdapter<HookType>::run<Call, handler> is such a
// hook that gathers its parameters, in order, into the aggregate Call and passes that to handler(const Call&): the
// handler takes one struct, and no C++ exception leaves the hook.
#pragma once

#include "AE_GeneralPlug.h"
#include "ae_log.h"

namespace extynt::ae {

template <typename Hook>
struct HookAdapter;

template <typename... Parameters>
struct HookAdapter<A_Err (*)(Parameters...)> {
  template <typename Call, void (*Handler)(const Call&)>
  static A_Err run(Parameters... parameters) noexcept {
    try {
      Handler(Call{parameters...});
    } catch (...) {
      logDroppedException("after effects hook");
    }
    return A_Err_NONE;
  }
};

}

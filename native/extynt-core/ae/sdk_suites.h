// Typed suite acquisition. SPBasicSuite::AcquireSuite returns every suite through a const void** out-parameter; that
// parameter type appears once, in this template, and callers get the suite's own struct type.
#pragma once

#include "SPBasic.h"

namespace extynt::ae {

// Which suite to ask the host for: the struct type the host hands back, the SDK's name string and the version number.
// One constant per suite lives in sdk_suite_ids.h.
template <typename Suite>
struct SuiteId {
  const char* name;
  int version;
};

// Acquires one suite into `slot`, whose type must be the one the id names. Returns true when the host handed it out;
// `error` is the SPErr either way.
template <typename Suite>
bool acquireSuite(const SPBasicSuite& basic, const SuiteId<Suite>& id, const Suite*& slot, long& error) {
  const void* suite = nullptr;
  error = basic.AcquireSuite(id.name, id.version, &suite);
  if (error != 0 || suite == nullptr) return false;
  slot = static_cast<const Suite*>(suite);
  return true;
}

}

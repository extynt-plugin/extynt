// The typed view of a locked AEGP memory handle. AEGP_LockMemHandle hands the block out through a void** parameter;
// that parameter type appears once, in lock(), and the block is kept as text bytes from there on.
#pragma once

#include "A.h"
#include "AE_GeneralPlug.h"

namespace extynt::ae {

// Locks `handle` on construction and unlocks it on destruction unless unlock() already did; the memory suite must
// outlive it. The handle itself stays owned by the caller.
class MemoryLock {
 public:
  MemoryLock(const AEGP_MemorySuite1& memory, AEGP_MemHandle handle) : memory_(&memory), handle_(handle) {
    void* raw = nullptr;
    lockError_ = memory.AEGP_LockMemHandle(handle, &raw);
    held_ = lockError_ == A_Err_NONE;
    block_ = held_ ? static_cast<const char*>(raw) : nullptr;
  }
  ~MemoryLock() { static_cast<void>(unlock()); }
  MemoryLock(const MemoryLock&) = delete;
  MemoryLock& operator=(const MemoryLock&) = delete;
  MemoryLock(MemoryLock&&) = delete;
  MemoryLock& operator=(MemoryLock&&) = delete;

  // The error AEGP_LockMemHandle returned.
  [[nodiscard]] A_Err lockError() const { return lockError_; }

  // True while the handle is locked by this object and the host gave out a readable block.
  [[nodiscard]] bool locked() const { return held_ && block_ != nullptr; }

  // The block as eight-bit text bytes; null unless locked().
  [[nodiscard]] const char* chars() const { return held_ ? block_ : nullptr; }

  // The block as 16-bit code units; null unless locked().
  [[nodiscard]] const A_u_short* units() const { return held_ ? reinterpret_cast<const A_u_short*>(block_) : nullptr; }

  // Unlocks now and returns the SDK's error; a lock that is not held is left alone and reports no error.
  A_Err unlock() {
    if (!held_) return A_Err_NONE;
    held_ = false;
    block_ = nullptr;
    return memory_->AEGP_UnlockMemHandle(handle_);
  }

 private:
  const AEGP_MemorySuite1* memory_;
  AEGP_MemHandle handle_;
  const char* block_ = nullptr;
  bool held_ = false;
  A_Err lockError_ = A_Err_NONE;
};

}

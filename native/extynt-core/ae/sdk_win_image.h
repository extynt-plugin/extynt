// A typed view of a loaded PE image (export table, import table, size) and the writes the network guard makes into
// one: a page-protection-aware slot write and a jump stub in free memory near the image. The RVA arithmetic and the
// casts it needs exist only here.
#pragma once

#include <windows.h>

#include <cstdint>
#include <optional>
#include <vector>

#include "sdk_win_socket.h"

namespace extynt::ae::sdkwin {

class PeImage {
 public:
  explicit PeImage(HMODULE module);

  [[nodiscard]] DWORD sizeOfImage() const;

  // The export table slot that holds the RVA of the exported function `name`, or null.
  DWORD* exportSlot(const char* name) const;

  // The import address table slots of the imports from `library` (compared without case), empty when none.
  std::vector<ULONG_PTR*> importSlots(const char* library) const;

  [[nodiscard]] uintptr_t baseAddress() const;

  // The RVA of an address that lies within an RVA's reach above the image.
  [[nodiscard]] DWORD rvaOf(uintptr_t address) const;

 private:
  [[nodiscard]] const IMAGE_DATA_DIRECTORY* directory(int entry) const;

  BYTE* base_;
};

// Writes `value` into `*slot` after making the page writable, then restores the protection. False when the page could
// not be made writable.
template <typename T>
bool writeProtected(T* slot, T value) {
  DWORD previous = 0;
  if (VirtualProtect(slot, sizeof(T), PAGE_READWRITE, &previous) == FALSE) return false;
  *slot = value;
  VirtualProtect(slot, sizeof(T), previous, &previous);
  return true;
}

// A jump to `target` placed in free memory above `image` and within an RVA's reach of it, since an export can only
// name an address there. The RVA of the stub, or nothing when no memory was free.
std::optional<DWORD> allocateJumpStubNear(const PeImage& image, BindFunction function);

// Points the import slot at `replacement` when it currently holds `expected`; false when it holds something else or the
// page could not be made writable.
bool replaceImport(ULONG_PTR* slot, BindFunction expected, BindFunction replacement);

}

// The PE image view and the jump stub allocator declared in sdk_win_image.h.
#include "sdk_win_image.h"

#include <windows.h>

#include <array>
#include <cstdint>
#include <cstring>
#include <optional>
#include <vector>

namespace extynt::ae::sdkwin {

namespace {

constexpr uintptr_t kAllocationStep = 0x10000;
constexpr uintptr_t kRvaReach = 0x7FFF0000;
constexpr SIZE_T kStubBytes = 64;
constexpr std::array<BYTE, 6> kIndirectJump{0xFF, 0x25, 0, 0, 0, 0};

}

PeImage::PeImage(HMODULE module) : base_(reinterpret_cast<BYTE*>(module)) {}

const IMAGE_DATA_DIRECTORY* PeImage::directory(int entry) const {
  const auto* dos = reinterpret_cast<const IMAGE_DOS_HEADER*>(base_);
  if (dos->e_magic != IMAGE_DOS_SIGNATURE) return nullptr;
  const auto* nt = reinterpret_cast<const IMAGE_NT_HEADERS*>(base_ + dos->e_lfanew);
  if (nt->Signature != IMAGE_NT_SIGNATURE) return nullptr;
  const IMAGE_DATA_DIRECTORY* found = std::data(nt->OptionalHeader.DataDirectory) + entry;
  return found->VirtualAddress == 0 || found->Size == 0 ? nullptr : found;
}

DWORD PeImage::sizeOfImage() const {
  const auto* dos = reinterpret_cast<const IMAGE_DOS_HEADER*>(base_);
  return reinterpret_cast<const IMAGE_NT_HEADERS*>(base_ + dos->e_lfanew)->OptionalHeader.SizeOfImage;
}

uintptr_t PeImage::baseAddress() const { return reinterpret_cast<uintptr_t>(base_); }

DWORD PeImage::rvaOf(uintptr_t address) const { return static_cast<DWORD>(address - baseAddress()); }

DWORD* PeImage::exportSlot(const char* name) const {
  const IMAGE_DATA_DIRECTORY* table = directory(IMAGE_DIRECTORY_ENTRY_EXPORT);
  if (table == nullptr) return nullptr;
  const auto* exports = reinterpret_cast<const IMAGE_EXPORT_DIRECTORY*>(base_ + table->VirtualAddress);
  const auto* names = reinterpret_cast<const DWORD*>(base_ + exports->AddressOfNames);
  const auto* ordinals = reinterpret_cast<const WORD*>(base_ + exports->AddressOfNameOrdinals);
  auto* functions = reinterpret_cast<DWORD*>(base_ + exports->AddressOfFunctions);
  for (DWORD i = 0; i < exports->NumberOfNames; ++i) {
    if (std::strcmp(reinterpret_cast<const char*>(base_ + names[i]), name) == 0) return &functions[ordinals[i]];
  }
  return nullptr;
}

std::vector<ULONG_PTR*> PeImage::importSlots(const char* library) const {
  std::vector<ULONG_PTR*> slots;
  const IMAGE_DATA_DIRECTORY* table = directory(IMAGE_DIRECTORY_ENTRY_IMPORT);
  if (table == nullptr) return slots;
  for (auto* entry = reinterpret_cast<IMAGE_IMPORT_DESCRIPTOR*>(base_ + table->VirtualAddress); entry->Name != 0;
       ++entry) {
    if (_stricmp(reinterpret_cast<const char*>(base_ + entry->Name), library) != 0) continue;
    for (auto* thunk = reinterpret_cast<ULONG_PTR*>(base_ + entry->FirstThunk); *thunk != 0; ++thunk) {
      slots.push_back(thunk);
    }
  }
  return slots;
}

bool replaceImport(ULONG_PTR* slot, BindFunction expected, BindFunction replacement) {
  if (*slot != reinterpret_cast<uintptr_t>(expected)) return false;
  return writeProtected(slot, static_cast<ULONG_PTR>(reinterpret_cast<uintptr_t>(replacement)));
}

std::optional<DWORD> allocateJumpStubNear(const PeImage& image, BindFunction function) {
  const auto target = reinterpret_cast<uintptr_t>(function);
  const uintptr_t base = image.baseAddress();
  for (uintptr_t at = (base + image.sizeOfImage() + kAllocationStep - 1) & ~(kAllocationStep - 1);
       at < base + kRvaReach; at += kAllocationStep) {
    MEMORY_BASIC_INFORMATION region{};
    if (VirtualQuery(reinterpret_cast<LPCVOID>(at), &region, sizeof(region)) == 0) return std::nullopt;
    if (region.State != MEM_FREE) continue;
    auto* stub = static_cast<BYTE*>(
        VirtualAlloc(reinterpret_cast<LPVOID>(at), kStubBytes, MEM_RESERVE | MEM_COMMIT, PAGE_EXECUTE_READWRITE));
    if (stub == nullptr) continue;
    std::memcpy(stub, kIndirectJump.data(), kIndirectJump.size());
    std::memcpy(stub + kIndirectJump.size(), &target, sizeof(target));
    DWORD previous = 0;
    VirtualProtect(stub, kStubBytes, PAGE_EXECUTE_READ, &previous);
    FlushInstructionCache(GetCurrentProcess(), stub, kStubBytes);
    return image.rvaOf(reinterpret_cast<uintptr_t>(stub));
  }
  return std::nullopt;
}

}

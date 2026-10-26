// Resource bytes and file version, the parts of sdk_win_module.h that are not templates.
#include "sdk_win_module.h"

#include <windows.h>

#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace extynt::ae::sdkwin {

namespace {

HMODULE moduleAt(LPCWSTR address, DWORD flags) {
  HMODULE module = nullptr;
  if (GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | flags, address, &module) == FALSE) return nullptr;
  return module;
}

}

HMODULE moduleContaining(WNDPROC procedure) {
  return moduleAt(reinterpret_cast<LPCWSTR>(procedure), GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT);
}

bool pinModuleContaining(BindFunction function) {
  return moduleAt(reinterpret_cast<LPCWSTR>(function), GET_MODULE_HANDLE_EX_FLAG_PIN) != nullptr;
}

bool pinModuleContaining(void (*function)() noexcept) {
  return moduleAt(reinterpret_cast<LPCWSTR>(function), GET_MODULE_HANDLE_EX_FLAG_PIN) != nullptr;
}

std::string_view resourceBytes(HMODULE module, LPCWSTR type, LPWSTR name) {
  HRSRC found = FindResourceW(module, name, type);
  if (found == nullptr) return {};
  const HGLOBAL loaded = LoadResource(module, found);
  const char* data = loaded != nullptr ? static_cast<const char*>(LockResource(loaded)) : nullptr;
  if (data == nullptr) return {};
  return {data, SizeofResource(module, found)};
}

std::optional<VS_FIXEDFILEINFO> fixedFileInfo(const std::wstring& path) {
  DWORD ignored = 0;
  const DWORD size = GetFileVersionInfoSizeW(path.c_str(), &ignored);
  if (size == 0) return std::nullopt;
  std::vector<char> block(size);
  if (GetFileVersionInfoW(path.c_str(), 0, size, block.data()) == 0) return std::nullopt;
  VS_FIXEDFILEINFO* value = nullptr;
  UINT length = 0;
  if (VerQueryValueW(block.data(), L"\\", reinterpret_cast<LPVOID*>(&value), &length) == 0 || value == nullptr ||
      length < sizeof(VS_FIXEDFILEINFO)) {
    return std::nullopt;
  }
  return *value;
}

}

// Loaded-module services that hand out untyped values: the module that owns a piece of code, pinning it, exported
// function lookup, resource enumeration and the fixed version of a file. The conversions exist only here.
#pragma once

#include <winsock2.h>
#include <windows.h>

#include <exception>
#include <optional>
#include <string>
#include <string_view>

#include "sdk_win_socket.h"

namespace extynt::ae::sdkwin {

// The module whose code contains the window procedure `procedure`; null when none does. The reference count is not
// changed.
HMODULE moduleContaining(WNDPROC procedure);

// Pins the module whose code contains `function` so it is never unloaded; false when that failed.
bool pinModuleContaining(BindFunction function);
bool pinModuleContaining(void (*function)() noexcept);

// Calls `visitor(module, type, name)` for each resource of `type` in `module` until it returns false.
template <typename Visitor>
void forEachResourceName(HMODULE module, LPCWSTR type, const Visitor& visitor) {
  struct Visit {
    const Visitor* callable = nullptr;
    std::exception_ptr error;
  } visit{&visitor, nullptr};
  EnumResourceNamesW(
      module, type,
      [](HMODULE owner, LPCWSTR kind, LPWSTR name, LONG_PTR parameter) noexcept -> BOOL {
        auto& state = *reinterpret_cast<Visit*>(parameter);
        try {
          return (*state.callable)(owner, kind, name) ? TRUE : FALSE;
        } catch (...) {
          state.error = std::current_exception();
          return FALSE;
        }
      },
      reinterpret_cast<LONG_PTR>(&visit));
  if (visit.error) std::rethrow_exception(visit.error);
}

// The bytes of a resource, mapped in `module`; empty when it cannot be loaded.
std::string_view resourceBytes(HMODULE module, LPCWSTR type, LPWSTR name);

// The fixed file version of the executable at `path`; nothing when it has none.
std::optional<VS_FIXEDFILEINFO> fixedFileInfo(const std::wstring& path);

}

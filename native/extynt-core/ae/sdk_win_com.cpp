// The COM allocation helper that needs an untyped allocation: strings handed back to COM callers.
#include "sdk_win_com.h"

#include <windows.h>

#include <cwchar>
#include <string>

namespace extynt::ae::panel {

HRESULT copyToCoTaskString(const std::wstring& text, LPWSTR* out) {
  if (out == nullptr) return E_POINTER;
  const std::size_t characters = text.size() + 1;
  auto* memory = static_cast<wchar_t*>(CoTaskMemAlloc(characters * sizeof(wchar_t)));
  if (memory == nullptr) return E_OUTOFMEMORY;
  std::wmemcpy(memory, text.c_str(), characters);
  *out = memory;
  return S_OK;
}

}

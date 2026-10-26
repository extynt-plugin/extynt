// Windows only. Reads strings that WebView2 allocated with CoTaskMemAlloc; the COM helpers themselves are in
// sdk_win_com.h.
#pragma once

#include <windows.h>
#include <objbase.h>

#include <string>

#include "sdk_win_com.h"
#include "windows_paths.h"

namespace extynt::ae::panel {

// UTF-8 text of a string WebView2 allocated with CoTaskMemAlloc, which this frees. Empty for null.
inline std::string takeString(LPWSTR owned) {
  if (owned == nullptr) return {};
  std::string text = win::narrow(owned);
  CoTaskMemFree(owned);
  return text;
}

}

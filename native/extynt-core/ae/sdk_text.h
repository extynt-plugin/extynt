// The SDK takes text as unsigned bytes (A_u_char); this is the only place a C string literal becomes one.
#pragma once

#include "A.h"

namespace extynt::ae {

// `text` viewed as the SDK's unsigned byte string; it must outlive the use (a literal does).
inline const A_u_char* sdkText(const char* text) { return reinterpret_cast<const A_u_char*>(text); }

}

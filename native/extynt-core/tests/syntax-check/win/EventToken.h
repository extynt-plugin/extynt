// The one WebView2 type a non-MSVC header set lacks (EventToken.h ships with the Windows SDK): lets the Linux cross
// check read WebView2.h. Never used by the real build.
#pragma once
#include <stdint.h>
typedef struct EventRegistrationToken {
  int64_t value;
} EventRegistrationToken;

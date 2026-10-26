// Windows only. The WebView2 environment options: browser arguments and a language, as a COM object.
#pragma once

#include <string>

#include "sdk_win_com.h"

namespace extynt::ae::panel {

// Options whose AdditionalBrowserArguments is `arguments`. The runtime must be at least as new as a conservative
// floor, so any current Evergreen install qualifies.
ComRef<ICoreWebView2EnvironmentOptions> makeEnvironmentOptions(const std::wstring& arguments);

}

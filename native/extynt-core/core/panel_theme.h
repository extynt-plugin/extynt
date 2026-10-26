// The host's UI colour as the page wants it. Pure core: the plugin reads the colour from AE (PF_AppGetBgColor) and this
// turns it into the `theme` of window.__extyntNative and of the "extynt-theme" event (docs/native/ui-contract.md).
#pragma once

#include <string>

namespace extynt::ae {

struct HostTheme {
  // "#rrggbb", lower case
  std::string background;
  // 0 (black) .. 1 (white), perceived brightness of the gamma-encoded colour, 3 decimals
  double luminance = 0;
};

// `red`, `green` and `blue` are PF_App_Color channels. They are 16-bit (0..65535); a colour whose largest channel is
// at most 255 is read as 8-bit instead, which only misreads a 16-bit colour that is already black to the eye.
HostTheme hostThemeFromAppColor(unsigned red, unsigned green, unsigned blue);

}

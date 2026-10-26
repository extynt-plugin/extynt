// Turns an After Effects background colour into the CSS colours and theme event the page consumes.

#include "panel_theme.h"

#include <algorithm>
#include <cmath>
#include <string>

namespace extynt::ae {

namespace {

constexpr unsigned kMax8 = 255;
constexpr unsigned kMax16 = 65535;

unsigned toEightBit(unsigned value, bool wide) {
  if (!wide) return std::min(value, kMax8);
  return ((std::min(value, kMax16) * kMax8) + (kMax16 / 2)) / kMax16;
}

void appendHexByte(std::string& out, unsigned value) {
  static const char* const kDigits = "0123456789abcdef";
  out += kDigits[(value >> 4) & 0xF];
  out += kDigits[value & 0xF];
}

}

HostTheme hostThemeFromAppColor(unsigned red, unsigned green, unsigned blue) {
  const bool wide = std::max({red, green, blue}) > kMax8;
  const unsigned r = toEightBit(red, wide);
  const unsigned g = toEightBit(green, wide);
  const unsigned b = toEightBit(blue, wide);
  HostTheme theme;
  theme.background = "#";
  appendHexByte(theme.background, r);
  appendHexByte(theme.background, g);
  appendHexByte(theme.background, b);
  const double brightness = ((0.2126 * r) + (0.7152 * g) + (0.0722 * b)) / static_cast<double>(kMax8);
  theme.luminance = std::round(brightness * 1000.0) / 1000.0;
  return theme;
}

}

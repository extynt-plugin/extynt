// The look's tokens, from the site: see CatalogueTheme.h.
#import "CatalogueTheme.h"

NSColor* ExtyntInk(uint32_t light, uint32_t dark) {
  return [NSColor colorWithName:nil
                dynamicProvider:^NSColor*(NSAppearance* appearance) {
                  BOOL isDark = [[appearance
                      bestMatchFromAppearancesWithNames:@[ NSAppearanceNameAqua, NSAppearanceNameDarkAqua ]]
                      isEqual:NSAppearanceNameDarkAqua];
                  uint32_t hex = isDark ? dark : light;
                  return [NSColor colorWithSRGBRed:((hex >> 16) & 0xff) / 255.0
                                             green:((hex >> 8) & 0xff) / 255.0
                                              blue:(hex & 0xff) / 255.0
                                             alpha:1];
                }];
}

NSColor* ExtyntPaper(void) { return ExtyntInk(0xfbfaf7, 0x1b1b1a); }
NSColor* ExtyntText(void) { return ExtyntInk(0x151515, 0xf4f2ec); }
NSColor* ExtyntBand(void) { return ExtyntInk(0x151515, 0xf4f2ec); }
NSColor* ExtyntOnBand(void) { return ExtyntInk(0xf4f2ec, 0x151515); }
NSColor* ExtyntOnBandMuted(void) { return ExtyntInk(0xa9a59b, 0x55534d); }
NSColor* ExtyntMuted(void) { return ExtyntInk(0x55534d, 0xc9c5bb); }
NSColor* ExtyntFaint(void) { return ExtyntInk(0x6a675f, 0xa9a59b); }
NSColor* ExtyntLine(void) { return ExtyntInk(0xd9d5ca, 0x3a3834); }
NSColor* ExtyntDrop(void) { return ExtyntInk(0x151515, 0x4a4741); }
NSColor* ExtyntGreen(void) { return ExtyntInk(0x1d6a3c, 0x6fbf8a); }
NSColor* ExtyntAmber(void) { return ExtyntInk(0x855300, 0xe2ad55); }
NSColor* ExtyntAmberSoft(void) { return ExtyntInk(0xf3e7cf, 0x2c2518); }

NSFont* ExtyntMono(CGFloat size, NSFontWeight weight) {
  NSFont* plex = [NSFont fontWithName:weight >= NSFontWeightSemibold ? @"IBMPlexMono-SemiBold" : @"IBMPlexMono-Medium"
                                 size:size];
  return plex ?: [NSFont monospacedSystemFontOfSize:size weight:weight];
}

NSFont* ExtyntSans(CGFloat size, NSFontWeight weight) {
  NSFont* plex = [NSFont fontWithName:weight >= NSFontWeightSemibold ? @"IBMPlexSans-SemiBold" : @"IBMPlexSans"
                                 size:size];
  return plex ?: [NSFont systemFontOfSize:size weight:weight];
}

NSTextField* ExtyntLabel(NSFont* font, NSColor* color) {
  NSTextField* field = [NSTextField labelWithString:@""];
  field.font = font;
  field.textColor = color;
  field.lineBreakMode = NSLineBreakByTruncatingTail;
  return field;
}

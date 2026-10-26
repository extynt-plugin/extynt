// extynt.com's ink-on-paper look for the "Learning your effects" page: the colour tokens (dark mode swaps paper and
// ink), the two type families (IBM Plex when installed, the system faces otherwise) and the one-line text label.
#import <Cocoa/Cocoa.h>

/** The colour that follows the appearance: `light` in Aqua, `dark` in Dark Aqua, both as 0xRRGGBB. */
NSColor* ExtyntInk(uint32_t light, uint32_t dark);
/** The page and the receipt card. */
NSColor* ExtyntPaper(void);
/** Body ink. */
NSColor* ExtyntText(void);
/** The band across the top of the page. */
NSColor* ExtyntBand(void);
/** Ink drawn on the band. */
NSColor* ExtyntOnBand(void);
/** Secondary ink drawn on the band. */
NSColor* ExtyntOnBandMuted(void);
/** Secondary body ink. */
NSColor* ExtyntMuted(void);
/** The faintest body ink. */
NSColor* ExtyntFaint(void);
/** The rule between receipt rows. */
NSColor* ExtyntLine(void);
/** The receipt's hard offset shadow. */
NSColor* ExtyntDrop(void);
/** A finished row. */
NSColor* ExtyntGreen(void);
/** A row that will finish later. */
NSColor* ExtyntAmber(void);
/** The wash behind a row that will finish later. */
NSColor* ExtyntAmberSoft(void);
/** IBM Plex Mono, or the system monospaced face. */
NSFont* ExtyntMono(CGFloat size, NSFontWeight weight);
/** IBM Plex Sans, or the system face. */
NSFont* ExtyntSans(CGFloat size, NSFontWeight weight);
/** An empty single-line label that truncates its tail. */
NSTextField* ExtyntLabel(NSFont* font, NSColor* color);

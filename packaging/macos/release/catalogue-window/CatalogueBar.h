// The ruled progress bar of the "Learning your effects" page.
#import <Cocoa/Cocoa.h>

/** A ruled bar: a 1px ink outline, an ink fill that eases to each new value, and a sliding block while the total is
 * unknown. */
@interface ExtyntBar : NSView
/** True while the total is unknown: the bar shows a sliding block instead of a fill. */
@property(nonatomic) BOOL indeterminate;
/** Eases the fill to `fraction`, clamped to 0...1. */
- (void)setFraction:(double)fraction;
@end

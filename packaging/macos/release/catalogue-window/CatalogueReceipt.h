// The receipt of the "Learning your effects" page: extynt.com's ruled, mono card with a hard offset shadow and one row
// per After Effects version.
#import <Cocoa/Cocoa.h>

/** How far the card's offset shadow reaches, which the view adds to the card's width and height. */
extern const CGFloat ExtyntReceiptDrop;
/** The most versions the receipt has rows for. */
extern const NSUInteger ExtyntReceiptMaxHosts;

/** The receipt: rows that end "later" get an amber wash. */
@interface ExtyntReceipt : NSView
/** How many rows are showing. */
@property(nonatomic, readonly) NSUInteger shown;
/** Shows one row per host (up to the most there are rows for), resizes itself to fit and hides itself when there are
 * none. */
- (void)showHosts:(NSArray*)hosts;
@end

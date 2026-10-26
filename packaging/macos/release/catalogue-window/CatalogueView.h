// What the "Learning your effects" page shows, apart from how it talks to the
// sidecar: the heading, the progress bar, one receipt row per After Effects
// version and the note. Drawn in extynt.com's ink-on-paper look, light and
// dark. CatalogueWindow.m feeds it the engine status and preview/ feeds it
// canned ones.
#import <Cocoa/Cocoa.h>

/** How the catalogue run stands. */
typedef NS_ENUM(NSInteger, ExtyntCatalogueOutcome) {
  ExtyntCatalogueRunning,
  ExtyntCatalogueFinished,
  ExtyntCatalogueNoHosts,
};

/** The page: heading, progress bar, receipt rows and note. */
@interface ExtyntCatalogueView : NSView
/** The footer line once a run has ended (a failed scan, or an After Effects
 * that is open); empty otherwise. */
@property(nonatomic, copy) NSString* footnote;
/** True when the footer names a scan that can be tried again, so the window
 * offers Retry. */
@property(nonatomic) BOOL retryable;
/** The page before any status arrives. */
- (void)showStarting;
/** Draws the engine status (rows, bar and, once it has ended, the summary) and
 * says how the run stands. */
- (ExtyntCatalogueOutcome)render:(NSDictionary*)engine;
/** The page for when nothing could be learned here, with the reason. */
- (void)showGaveUp:(NSString*)why;
@end

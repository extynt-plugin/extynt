// The words of the "Learning your effects" page, read from the engine status the sidecar returns: what a version's
// engine is doing, how its scan ended and what was skipped. The C++ twin is catalogue_status.cpp; change the two
// together.
#import <Foundation/Foundation.h>

/** How a version's row is tagged. */
typedef NS_ENUM(NSInteger, ExtyntTagKind) { ExtyntTagWaiting, ExtyntTagWorking, ExtyntTagDone, ExtyntTagLater };

/** "3 effects", "1 effect". */
NSString* ExtyntPlural(NSInteger count, NSString* word);
/** The integer under `key`, or 0 when it is missing or not a number. */
NSInteger ExtyntIntOf(NSDictionary* dictionary, NSString* key);
/** A version's result dictionary, or nil while it has none. */
NSDictionary* ExtyntResultOf(NSDictionary* host);
/** The time-left suffix of the progress line; empty until enough effects have been probed to estimate it. */
NSString* ExtyntTimeLeft(NSDictionary* catalogue);
/** How one version's scan ended, in words that fit "After Effects 2026 <phrase>". */
NSString* ExtyntFailurePhrase(id value);
/** A scan that ended and can be tried again: it has a reason that is neither complete nor "After Effects is open". */
BOOL ExtyntRetryableReason(id value);
/** What one version's engine is doing now, or how it ended; empty when the tag already says it. */
NSString* ExtyntHostStatus(NSDictionary* host);
/** Which tag the version's row carries. */
ExtyntTagKind ExtyntKindOf(NSDictionary* host);
/** The tag's word, such as "LEARNING". */
NSString* ExtyntTagWord(NSDictionary* host);
/** The skipped effects, in plain words, across every version that finished. */
NSString* ExtyntSkippedNote(NSArray* hosts);

// The "Learning your effects" page: an ink band with the state, the ruled progress bar, the receipt and a note, laid
// out on extynt.com's ink-on-paper tokens (CatalogueTheme.h). The words come from CatalogueWords.h and are the same
// ones the page always used.
#import "CatalogueView.h"

#import "CatalogueBar.h"
#import "CatalogueReceipt.h"
#import "CatalogueTheme.h"
#import "CatalogueWords.h"

static const CGFloat kPad = 20, kBandHeight = 74;

static BOOL AnyLearned(NSArray* hosts) {
  for (NSDictionary* host in hosts)
    if (ExtyntIntOf(ExtyntResultOf(host), @"collected") > 0) return YES;
  return NO;
}

static NSDictionary* FirstRetryable(NSArray* hosts) {
  for (NSDictionary* host in hosts)
    if (ExtyntRetryableReason(host[@"reason"])) return host;
  return nil;
}

static BOOL AnyAfterEffectsOpen(NSArray* hosts) {
  for (NSDictionary* host in hosts)
    if ([host[@"reason"] isEqual:@"after-effects-open"]) return YES;
  return NO;
}

@implementation ExtyntCatalogueView {
  NSTextField *_eyebrow, *_heading, *_detail, *_note;
  ExtyntBar* _bar;
  ExtyntReceipt* _receipt;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if (!(self = [super initWithFrame:frame])) return nil;
  CGFloat width = NSWidth(frame) - 2 * kPad;
  _eyebrow = ExtyntLabel(ExtyntMono(9.5, NSFontWeightMedium), ExtyntOnBandMuted());
  _eyebrow.frame = NSMakeRect(kPad + 26, 16, width - 26, 13);
  _heading = ExtyntLabel(ExtyntSans(16, NSFontWeightSemibold), ExtyntOnBand());
  _heading.frame = NSMakeRect(kPad, 34, width, 22);
  _bar = [[ExtyntBar alloc] initWithFrame:NSMakeRect(kPad, kBandHeight + 18, width, 10)];
  _detail = ExtyntLabel(ExtyntSans(11.5, NSFontWeightRegular), ExtyntMuted());
  _detail.frame = NSMakeRect(kPad, kBandHeight + 34, width, 16);
  _receipt = [[ExtyntReceipt alloc] initWithFrame:NSMakeRect(kPad, kBandHeight + 62, width + ExtyntReceiptDrop, 0)];
  _note = [NSTextField wrappingLabelWithString:@""];
  _note.font = ExtyntSans(11, NSFontWeightRegular);
  _note.textColor = ExtyntMuted();
  for (NSView* view in @[ _eyebrow, _heading, _bar, _detail, _receipt, _note ]) [self addSubview:view];
  [self showRows:@[]];
  return self;
}

- (BOOL)isFlipped {
  return YES;
}

- (void)drawRect:(NSRect)dirty {
  [ExtyntPaper() setFill];
  NSRectFill(self.bounds);
  [ExtyntBand() setFill];
  NSRectFill(NSMakeRect(0, 0, NSWidth(self.bounds), kBandHeight));
  [ExtyntOnBand() setFill];
  NSRectFill(NSMakeRect(kPad, 22, 18, 1.5));
}

- (void)showHeading:(NSString*)heading detail:(NSString*)detail note:(NSString*)note {
  _heading.stringValue = heading;
  _detail.stringValue = detail;
  _note.stringValue = note;
}

- (void)showRows:(NSArray*)hosts {
  [_receipt showHosts:hosts];
  NSRect frame = _receipt.frame;
  CGFloat top = _receipt.shown ? NSMaxY(frame) + 14 : NSMinY(frame);
  _note.frame = NSMakeRect(kPad, top, NSWidth(self.bounds) - 2 * kPad, MAX(0, NSHeight(self.bounds) - top - 12));
}

- (void)showStarting {
  _eyebrow.stringValue = @"EFFECT CATALOGUE · NO WINDOW OPENS";
  _bar.indeterminate = YES;
  [self showHeading:@"Learning every effect you own"
             detail:@"Starting After Effects. No window opens."
               note:@"Continue whenever. It finishes in the background."];
}

- (void)showGaveUp:(NSString*)why {
  _eyebrow.stringValue = @"EFFECT CATALOGUE · LATER";
  _bar.hidden = YES;
  [self showHeading:@"Not here. Later, then"
             detail:why
               note:@"The install is fine. extynt learns them when After Effects next opens."];
}

- (ExtyntCatalogueOutcome)render:(NSDictionary*)engine {
  self.footnote = @"";
  self.retryable = NO;
  NSArray* hosts = [engine[@"hosts"] isKindOfClass:[NSArray class]] ? engine[@"hosts"] : @[];
  NSDictionary* live = [engine[@"catalogue"] isKindOfClass:[NSDictionary class]] ? engine[@"catalogue"] : nil;
  [self showRows:hosts];
  if (hosts.count == 0) return ExtyntCatalogueNoHosts;
  NSString* state = engine[@"state"];
  if ([state isEqual:@"done"] || [state isEqual:@"failed"]) {
    [self showFinished:hosts];
    return ExtyntCatalogueFinished;
  }
  [self showLive:hosts live:live];
  return ExtyntCatalogueRunning;
}

- (void)showLive:(NSArray*)hosts live:(NSDictionary*)live {
  NSDictionary* running = nil;
  for (NSDictionary* host in hosts)
    if ([host[@"state"] isEqual:@"running"]) running = host;
  NSInteger installed = ExtyntIntOf(live, @"installed"), collected = ExtyntIntOf(live, @"collected");
  if (![running[@"phase"] isEqual:@"learning"] || installed == 0) return;
  _eyebrow.stringValue = [NSString stringWithFormat:@"EFFECT CATALOGUE · AFTER EFFECTS %@", running[@"year"]];
  _bar.indeterminate = NO;
  [_bar setFraction:(double)collected / (double)installed];
  _detail.stringValue =
      [NSString stringWithFormat:@"%ld of %ld%@", (long)collected, (long)installed, ExtyntTimeLeft(live)];
}

- (void)showFailed:(NSDictionary*)failed note:(NSString*)note {
  self.footnote =
      [NSString stringWithFormat:@"After Effects %@ %@.", failed[@"year"], ExtyntFailurePhrase(failed[@"reason"])];
  self.retryable = YES;
  NSString* kept = note.length ? [note stringByAppendingString:@" Your existing catalogue is still used."]
                               : @"Your existing catalogue is still used.";
  NSString* close =
      [failed[@"reason"] isEqual:@"modal-blocked"] ? @"Close the dialog After Effects is showing, then retry. " : @"";
  [self showHeading:@"Learning didn't finish"
             detail:@"Retry, or click Done."
               note:[close stringByAppendingString:kept]];
}

- (void)showFinished:(NSArray*)hosts {
  _eyebrow.stringValue = @"EFFECT CATALOGUE · DONE";
  _bar.indeterminate = NO;
  [_bar setFraction:1];
  NSString* note = ExtyntSkippedNote(hosts);
  NSDictionary* failed = FirstRetryable(hosts);
  if (failed) {
    [self showFailed:failed note:note];
    return;
  }
  if (AnyAfterEffectsOpen(hosts)) self.footnote = @"After Effects is open: restart it to load extynt.";
  [self showHeading:AnyLearned(hosts) ? @"Your effects are learned" : @"Not here. Later, then"
             detail:@"That's it. Click Done."
               note:note.length ? note : @"None skipped. We checked."];
}

@end

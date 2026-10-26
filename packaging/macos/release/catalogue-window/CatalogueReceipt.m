// The receipt's rows (a glyph and a mono tag, then the version and what its engine is doing) and its card. See
// CatalogueReceipt.h.
#import "CatalogueReceipt.h"

#import "CatalogueTheme.h"
#import "CatalogueWords.h"

const CGFloat ExtyntReceiptDrop = 4;
const NSUInteger ExtyntReceiptMaxHosts = 4;
static const CGFloat kHeadHeight = 24, kRowHeight = 38, kTagWidth = 92;

@interface ExtyntHostRow : NSView
@property(nonatomic, readonly) ExtyntTagKind kind;
@property(nonatomic, readonly) CGFloat height;
- (void)show:(NSDictionary*)host;
@end

@implementation ExtyntHostRow {
  NSTextField *_tag, *_name, *_status;
  NSImageView* _glyph;
  NSProgressIndicator* _spinner;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if (!(self = [super initWithFrame:frame])) return nil;
  _glyph = [[NSImageView alloc] initWithFrame:NSMakeRect(12, 12, 12, 12)];
  _spinner = [[NSProgressIndicator alloc] initWithFrame:NSMakeRect(12, 12, 12, 12)];
  _spinner.style = NSProgressIndicatorStyleSpinning;
  _spinner.controlSize = NSControlSizeSmall;
  _spinner.displayedWhenStopped = NO;
  _tag = ExtyntLabel(ExtyntMono(10, NSFontWeightSemibold), ExtyntText());
  _tag.frame = NSMakeRect(30, 11, kTagWidth - 30, 14);
  _name = ExtyntLabel(ExtyntSans(12, NSFontWeightSemibold), ExtyntText());
  _name.frame = NSMakeRect(kTagWidth, 4, NSWidth(frame) - kTagWidth - 12, 16);
  _status = ExtyntLabel(ExtyntMono(10, NSFontWeightRegular), ExtyntFaint());
  _status.lineBreakMode = NSLineBreakByWordWrapping;
  _status.maximumNumberOfLines = 2;
  _status.frame = NSMakeRect(kTagWidth, 20, NSWidth(frame) - kTagWidth - 12, 28);
  for (NSView* view in @[ _glyph, _spinner, _tag, _name, _status ]) [self addSubview:view];
  return self;
}

- (BOOL)isFlipped {
  return YES;
}

- (void)show:(NSDictionary*)host {
  _kind = ExtyntKindOf(host);
  _name.stringValue = [NSString stringWithFormat:@"After Effects %@", host[@"year"]];
  _status.stringValue = ExtyntHostStatus(host);
  CGFloat lines =
      [_status.stringValue sizeWithAttributes:@{NSFontAttributeName : _status.font}].width > NSWidth(_status.frame) ? 2
                                                                                                                    : 1;
  _height = kRowHeight + (lines - 1) * 13;
  _name.frame = NSMakeRect(NSMinX(_name.frame), _status.stringValue.length ? 4 : 11, NSWidth(_name.frame), 16);
  _tag.stringValue = ExtyntTagWord(host);
  NSDictionary* glyphs = @{
    @(ExtyntTagWaiting) : @"circle.dashed",
    @(ExtyntTagDone) : @"checkmark",
    @(ExtyntTagLater) : @"exclamationmark.triangle"
  };
  NSColor* color = @[ ExtyntFaint(), ExtyntText(), ExtyntGreen(), ExtyntAmber() ][_kind];
  _tag.textColor = color;
  _glyph.contentTintColor = color;
  NSImage* image =
      glyphs[@(_kind)] ? [NSImage imageWithSystemSymbolName:glyphs[@(_kind)] accessibilityDescription:nil] : nil;
  _glyph.image =
      [image imageWithSymbolConfiguration:[NSImageSymbolConfiguration configurationWithPointSize:10
                                                                                          weight:NSFontWeightSemibold]];
  _glyph.hidden = _kind == ExtyntTagWorking;
  if (_kind == ExtyntTagWorking) [_spinner startAnimation:nil];
  else [_spinner stopAnimation:nil];
}

@end

@interface ExtyntReceipt ()
@property(nonatomic, readonly) NSMutableArray<ExtyntHostRow*>* rows;
@property(nonatomic) NSUInteger shown;
@property(nonatomic, readonly) NSTextField* count;
@end

@implementation ExtyntReceipt

- (instancetype)initWithFrame:(NSRect)frame {
  if (!(self = [super initWithFrame:frame])) return nil;
  CGFloat width = NSWidth(frame) - ExtyntReceiptDrop;
  NSTextField* title = ExtyntLabel(ExtyntMono(10, NSFontWeightMedium), ExtyntText());
  title.stringValue = @"Receipt · Effect catalogue";
  title.frame = NSMakeRect(12, 5, width - 120, 14);
  _count = ExtyntLabel(ExtyntMono(10, NSFontWeightRegular), ExtyntMuted());
  _count.alignment = NSTextAlignmentRight;
  _count.frame = NSMakeRect(width - 112, 5, 100, 14);
  [self addSubview:title];
  [self addSubview:_count];
  _rows = [NSMutableArray array];
  for (NSUInteger index = 0; index < ExtyntReceiptMaxHosts; index++) {
    ExtyntHostRow* row =
        [[ExtyntHostRow alloc] initWithFrame:NSMakeRect(1, kHeadHeight + index * kRowHeight, width - 2, kRowHeight)];
    [_rows addObject:row];
    [self addSubview:row];
  }
  return self;
}

- (BOOL)isFlipped {
  return YES;
}

- (void)showHosts:(NSArray*)hosts {
  NSUInteger shown = MIN(hosts.count, ExtyntReceiptMaxHosts);
  for (NSUInteger index = 0; index < ExtyntReceiptMaxHosts; index++) {
    NSDictionary* host = index < shown ? hosts[index] : nil;
    self.rows[index].hidden = host == nil;
    if (host) [self.rows[index] show:host];
  }
  self.shown = shown;
  self.hidden = shown == 0;
  self.count.stringValue = ExtyntPlural((NSInteger)shown, @"version");
  NSRect frame = self.frame;
  frame.size.height = shown ? [self layoutRows] : 0;
  self.frame = frame;
  self.needsDisplay = YES;
}

- (CGFloat)layoutRows {
  CGFloat y = kHeadHeight;
  for (NSUInteger index = 0; index < self.shown; index++) {
    ExtyntHostRow* row = self.rows[index];
    row.frame = NSMakeRect(1, y, NSWidth(row.frame), row.height);
    y += row.height;
  }
  return y + 1 + ExtyntReceiptDrop;
}

- (void)drawRect:(NSRect)dirty {
  NSRect card = NSMakeRect(0, 0, NSWidth(self.bounds) - ExtyntReceiptDrop, NSHeight(self.bounds) - ExtyntReceiptDrop);
  [ExtyntDrop() setFill];
  NSRectFill(NSOffsetRect(card, ExtyntReceiptDrop, ExtyntReceiptDrop));
  [ExtyntPaper() setFill];
  NSRectFill(card);
  for (NSUInteger index = 0; index < self.shown; index++) {
    NSRect band = NSMakeRect(1, NSMinY(self.rows[index].frame), NSWidth(card) - 2, self.rows[index].height);
    if (self.rows[index].kind == ExtyntTagLater) {
      [ExtyntAmberSoft() setFill];
      NSRectFill(band);
    }
    [(index + 1 < self.shown ? ExtyntLine() : ExtyntPaper()) setFill];
    NSRectFill(NSMakeRect(1, NSMaxY(band) - 1, NSWidth(band), 1));
  }
  [ExtyntText() setFill];
  NSRectFill(NSMakeRect(0, kHeadHeight - 1, NSWidth(card), 1));
  NSFrameRectWithWidth(card, 1);
}

@end

// Preview host for the installer's look, run by catalogue-window/preview.sh. Three modes:
//   html <file> <out.png> <light|dark> <width> <height> <scale> [query]  snapshot a page in WebKit (the background)
//   text <file> <out.png> <light|dark> <width> <height> <scale>          snapshot an installer page as Installer shows
//                                                                         HTML: imported as styled text, not a web page
//   pane <out-dir> <light|dark> [background.png]                         snapshot the catalogue page in each canned
//   state window <light|dark>                                                   show the catalogue page live, cycling
//   the states
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

#import "../CatalogueView.h"

NSArray<NSDictionary*>* ExtyntCannedStatuses(void);

static NSAppearance* AppearanceNamed(NSString* name) {
  return [NSAppearance appearanceNamed:[name isEqual:@"dark"] ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
}

static void Spin(NSTimeInterval seconds) {
  [[NSRunLoop mainRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:seconds]];
}

static void WritePNG(NSBitmapImageRep* rep, NSString* path, CGFloat scale) {
  rep.size = NSMakeSize(rep.pixelsWide / scale, rep.pixelsHigh / scale);
  [[rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:path atomically:YES];
}

static NSBitmapImageRep* Canvas(NSSize size, CGFloat scale) {
  return [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL
                                                 pixelsWide:(NSInteger)(size.width * scale)
                                                 pixelsHigh:(NSInteger)(size.height * scale)
                                              bitsPerSample:8
                                            samplesPerPixel:4
                                                   hasAlpha:YES
                                                   isPlanar:NO
                                             colorSpaceName:NSCalibratedRGBColorSpace
                                                bytesPerRow:0
                                               bitsPerPixel:0];
}

static void DrawInto(NSBitmapImageRep* rep, NSSize size, void (^draw)(void)) {
  [NSGraphicsContext saveGraphicsState];
  NSGraphicsContext* context = [NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
  NSGraphicsContext.currentContext = context;
  CGContextScaleCTM(context.CGContext, rep.pixelsWide / size.width, rep.pixelsHigh / size.height);
  draw();
  [NSGraphicsContext restoreGraphicsState];
}

static NSWindow* Window(NSSize size, NSString* appearance, BOOL visible) {
  NSRect frame =
      visible ? NSMakeRect(200, 200, size.width, size.height) : NSMakeRect(-10000, -10000, size.width, size.height);
  NSWindow* window = [[NSWindow alloc]
      initWithContentRect:frame
                styleMask:visible ? NSWindowStyleMaskTitled | NSWindowStyleMaskClosable : NSWindowStyleMaskBorderless
                  backing:NSBackingStoreBuffered
                    defer:NO];
  window.appearance = AppearanceNamed(appearance);
  window.releasedWhenClosed = NO;
  return window;
}

#pragma mark - html

static NSBitmapImageRep* SnapshotView(NSView* view) {
  NSBitmapImageRep* rep = [view bitmapImageRepForCachingDisplayInRect:view.bounds];
  [view cacheDisplayInRect:view.bounds toBitmapImageRep:rep];
  return rep;
}

static int SnapshotHTML(NSArray<NSString*>* args) {
  NSString *path = args[2], *out = args[3], *appearance = args[4], *query = args.count > 8 ? args[8] : nil;
  NSSize size = NSMakeSize(args[5].doubleValue, args[6].doubleValue);
  CGFloat scale = args[7].doubleValue;
  NSWindow* window = Window(size, appearance, NO);
  WKWebView* web = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, size.width, size.height)];
  web.appearance = AppearanceNamed(appearance);
  window.contentView = web;
  [window orderBack:nil];
  NSURL* file = [NSURL fileURLWithPath:path];
  NSURL* url = query ? [NSURL URLWithString:[@"?" stringByAppendingString:query] relativeToURL:file] : file;
  [web loadFileURL:url allowingReadAccessToURL:file.URLByDeletingLastPathComponent];
  while (web.isLoading) Spin(0.05);
  Spin(0.4);
  WKSnapshotConfiguration* config = [[WKSnapshotConfiguration alloc] init];
  config.rect = NSMakeRect(0, 0, size.width, size.height);
  config.snapshotWidth = @(size.width * scale);
  __block NSImage* shot = nil;
  [web takeSnapshotWithConfiguration:config
                   completionHandler:^(NSImage* image, NSError* error) { shot = image ?: [[NSImage alloc] init]; }];
  while (!shot) Spin(0.05);
  NSBitmapImageRep* rep = Canvas(size, scale);
  DrawInto(rep, size, ^{ [shot drawInRect:NSMakeRect(0, 0, size.width, size.height)]; });
  WritePNG(rep, out, scale);
  return 0;
}

#pragma mark - text

static int SnapshotText(NSArray<NSString*>* args) {
  NSString *path = args[2], *out = args[3], *appearance = args[4];
  NSSize size = NSMakeSize(args[5].doubleValue, args[6].doubleValue);
  NSMutableAttributedString* text = [[NSMutableAttributedString alloc] initWithHTML:[NSData dataWithContentsOfFile:path]
                                                                 documentAttributes:nil];
  [text enumerateAttribute:NSForegroundColorAttributeName
                   inRange:NSMakeRange(0, text.length)
                   options:0
                usingBlock:^(NSColor* color, NSRange range, BOOL* stop) {
                  NSColor* rgb = [color colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
                  if (!color || (rgb.redComponent < 0.05 && rgb.greenComponent < 0.05 && rgb.blueComponent < 0.05))
                    [text addAttribute:NSForegroundColorAttributeName value:NSColor.labelColor range:range];
                }];
  NSWindow* window = Window(size, appearance, NO);
  NSTextView* view = [[NSTextView alloc] initWithFrame:NSMakeRect(0, 0, size.width, size.height)];
  view.textContainerInset = NSMakeSize(10, 10);
  view.backgroundColor = NSColor.textBackgroundColor;
  [view.textStorage setAttributedString:text];
  window.contentView = view;
  [window orderBack:nil];
  Spin(0.2);
  NSBitmapImageRep* rep = SnapshotView(view);
  WritePNG(rep, out, rep.pixelsWide / size.width);
  return 0;
}

#pragma mark - pane

static void WriteInContext(NSBitmapImageRep* page, NSString* background, NSString* out) {
  NSSize size = NSMakeSize(620, 416);
  NSImage* image = [[NSImage alloc] initWithContentsOfFile:background];
  NSBitmapImageRep* rep = Canvas(size, 2);
  DrawInto(rep, size, ^{
    [image drawAtPoint:NSZeroPoint fromRect:NSZeroRect operation:NSCompositingOperationSourceOver fraction:1];
    [page drawInRect:NSMakeRect(183, 50, 416, 329)];
  });
  WritePNG(rep, out, 2);
}

static int SnapshotPane(NSArray<NSString*>* args) {
  NSString *dir = args[2], *appearance = args[3], *background = args.count > 4 ? args[4] : nil;
  NSWindow* window = Window(NSMakeSize(416, 329), appearance, NO);
  ExtyntCatalogueView* page = [[ExtyntCatalogueView alloc] initWithFrame:NSMakeRect(0, 0, 416, 329)];
  window.contentView = page;
  [window orderBack:nil];
  [page showStarting];
  NSMutableArray* states = [NSMutableArray arrayWithObject:@{@"name" : @"0-entering"}];
  [states addObjectsFromArray:ExtyntCannedStatuses()];
  for (NSDictionary* state in states) {
    if (state[@"engine"]) [page render:state[@"engine"]];
    Spin(0.9);
    NSBitmapImageRep* rep = SnapshotView(page);
    NSString* name = [NSString stringWithFormat:@"catalogue-%@-%@", appearance, state[@"name"]];
    WritePNG(rep, [dir stringByAppendingPathComponent:[name stringByAppendingString:@".png"]], rep.pixelsWide / 416.0);
    if (background)
      WriteInContext(rep, background,
                     [dir stringByAppendingPathComponent:[name stringByAppendingString:@"-window.png"]]);
  }
  return 0;
}

#pragma mark - window

static int ShowWindow(NSArray<NSString*>* args) {
  NSWindow* window = Window(NSMakeSize(416, 329), args.count > 2 ? args[2] : @"light", YES);
  window.title = @"Learning your effects (preview)";
  ExtyntCatalogueView* page = [[ExtyntCatalogueView alloc] initWithFrame:NSMakeRect(0, 0, 416, 329)];
  window.contentView = page;
  [page showStarting];
  [window makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];
  NSArray* states = ExtyntCannedStatuses();
  __block NSUInteger next = 0;
  [NSTimer scheduledTimerWithTimeInterval:2.5
                                  repeats:YES
                                    block:^(NSTimer* timer) {
                                      if (!window.isVisible) [NSApp terminate:nil];
                                      if (next < states.count) [page render:states[next++][@"engine"]];
                                    }];
  [NSApp run];
  return 0;
}

typedef struct {
  const char* name;
  NSUInteger minimumArguments;
  int (*run)(NSArray<NSString*>*);
} Mode;

static const Mode kModes[] = {
    {"html", 8, SnapshotHTML}, {"text", 8, SnapshotText}, {"pane", 4, SnapshotPane}, {"window", 2, ShowWindow}};

static NSString* ModeName(NSArray<NSString*>* args) { return args.count > 1 ? args[1] : @""; }

static int Usage(void) {
  NSString* text = @"usage: PreviewHost html|text|pane|window ... (see the comment at the top of PreviewHost.m)\n";
  [NSFileHandle.fileHandleWithStandardError writeData:[text dataUsingEncoding:NSUTF8StringEncoding]];
  return 2;
}

static int RunMode(NSArray<NSString*>* args) {
  for (const Mode* mode = kModes; mode < kModes + sizeof(kModes) / sizeof(kModes[0]); mode++)
    if ([ModeName(args) isEqual:@(mode->name)] && args.count >= mode->minimumArguments) return mode->run(args);
  return Usage();
}

int main(int argc, const char* argv[]) {
  @autoreleasepool {
    NSMutableArray<NSString*>* args = [NSMutableArray array];
    for (int index = 0; index < argc; index++) [args addObject:@(argv[index])];
    [NSApplication sharedApplication];
    NSApp.activationPolicy = [ModeName(args) isEqual:@"window"] ? NSApplicationActivationPolicyRegular
                                                                : NSApplicationActivationPolicyAccessory;
    return RunMode(args);
  }
}

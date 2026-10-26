// extynt Catalogue.app: learns the installed effects once, right after install, in a small window of its own. The
// package's postinstall opens it as the signed-in user and returns, so the Installer stays a plain package (no check
// script, no plugin page, so no "this package will run a program" warning). It reads the sidecar's session, starts the
// effect catalogue in After Effects' headless engine (POST /v1/catalogue/engine), follows it (GET, once a second) and,
// when it ends, says what was learned and skipped. Closing it early is fine: the sidecar carries on, and whatever is
// not learned now is learned in the background later (ADR 0043). ExtyntCatalogueView draws everything.
#import <Cocoa/Cocoa.h>

#import "CatalogueView.h"

static const NSTimeInterval kPollSeconds = 1, kSessionWaitSeconds = 60, kSummarySeconds = 90;
static const CGFloat kViewWidth = 418, kViewHeight = 330, kFooter = 52, kMargin = 16;

@interface ExtyntCatalogueController : NSObject <NSApplicationDelegate, NSWindowDelegate>
@end

@implementation ExtyntCatalogueController {
  NSWindow* _window;
  ExtyntCatalogueView* _page;
  NSTextField* _footnote;
  NSButton* _retry;
  NSTimer* _closer;
  NSTimer* _timer;
  NSString *_base, *_token;
  NSDate* _startedAt;
  BOOL _posted, _ended, _busy;
}

- (void)applicationDidFinishLaunching:(NSNotification*)notification {
  [self buildWindow];
  [_page showStarting];
  _footnote.stringValue = [self afterEffectsOpen] ? @"After Effects is open: restart it to load extynt." : @"";
  [_window center];
  [_window makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];
  _startedAt = [NSDate date];
  _timer = [NSTimer scheduledTimerWithTimeInterval:kPollSeconds
                                            target:self
                                          selector:@selector(tick)
                                          userInfo:nil
                                           repeats:YES];
  [self tick];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication*)sender {
  return YES;
}

- (BOOL)afterEffectsOpen {
  return [NSRunningApplication runningApplicationsWithBundleIdentifier:@"com.adobe.AfterEffects.application"].count > 0;
}

- (void)buildWindow {
  NSRect frame = NSMakeRect(0, 0, kViewWidth, kViewHeight + kFooter);
  _window = [[NSWindow alloc] initWithContentRect:frame
                                        styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable
                                          backing:NSBackingStoreBuffered
                                            defer:NO];
  _window.title = @"extynt";
  _window.level = NSFloatingWindowLevel;
  _window.releasedWhenClosed = NO;
  _window.delegate = self;
  _page = [[ExtyntCatalogueView alloc] initWithFrame:NSMakeRect(0, kFooter, kViewWidth, kViewHeight)];
  [_window.contentView addSubview:_page];
  NSButton* done = [NSButton buttonWithTitle:@"Done" target:self action:@selector(done:)];
  done.frame = NSMakeRect(kViewWidth - kMargin - 88, 12, 88, 28);
  done.keyEquivalent = @"\r";
  [_window.contentView addSubview:done];
  _retry = [NSButton buttonWithTitle:@"Retry" target:self action:@selector(retry:)];
  _retry.frame = NSMakeRect(kViewWidth - kMargin - 88 - 8 - 88, 12, 88, 28);
  _retry.hidden = YES;
  [_window.contentView addSubview:_retry];
  _footnote = [NSTextField labelWithString:@""];
  _footnote.frame = NSMakeRect(kMargin, 18, kViewWidth - 5 * kMargin - 2 * 88, 16);
  _footnote.font = [NSFont systemFontOfSize:11];
  _footnote.textColor = NSColor.secondaryLabelColor;
  [_window.contentView addSubview:_footnote];
}

- (void)done:(id)sender {
  [_window close];
}

- (void)retry:(id)sender {
  if (!_ended || !_page.retryable || _busy) return;
  [_closer invalidate];
  _footnote.stringValue = @"";
  _retry.hidden = YES;
  _page.retryable = NO;
  _ended = NO;
  _posted = NO;
  [_page showStarting];
  _timer = [NSTimer scheduledTimerWithTimeInterval:kPollSeconds
                                            target:self
                                          selector:@selector(tick)
                                          userInfo:nil
                                           repeats:YES];
}

#pragma mark Talking to the sidecar

- (BOOL)readSession {
  NSString* path = [@"~/Library/Application Support/extynt/session.json" stringByExpandingTildeInPath];
  NSData* data = [NSData dataWithContentsOfFile:path];
  NSDictionary* session = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  if (![session isKindOfClass:[NSDictionary class]] || !session[@"port"] ||
      ![session[@"token"] isKindOfClass:[NSString class]])
    return NO;
  _base = [NSString stringWithFormat:@"http://127.0.0.1:%@/v1/catalogue/engine", session[@"port"]];
  _token = session[@"token"];
  return YES;
}

- (void)request:(NSString*)method then:(void (^)(NSDictionary* body))then {
  NSMutableURLRequest* request = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:_base]];
  request.HTTPMethod = method;
  request.timeoutInterval = 10;
  [request setValue:[@"Bearer " stringByAppendingString:_token] forHTTPHeaderField:@"Authorization"];
  [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
  if ([method isEqual:@"POST"]) request.HTTPBody = [@"{}" dataUsingEncoding:NSUTF8StringEncoding];
  _busy = YES;
  [[[NSURLSession sharedSession] dataTaskWithRequest:request
                                   completionHandler:^(NSData* data, NSURLResponse* response, NSError* error) {
                                     NSDictionary* body =
                                         data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
                                     dispatch_async(dispatch_get_main_queue(), ^{
                                       self->_busy = NO;
                                       then([body isKindOfClass:[NSDictionary class]] ? body : nil);
                                     });
                                   }] resume];
}

- (void)tick {
  if (_busy || _ended) return;
  if (!_token && ![self readSession]) {
    if ([[NSDate date] timeIntervalSinceDate:_startedAt] > kSessionWaitSeconds)
      [self giveUp:@"extynt's helper didn't start in time."];
    return;
  }
  BOOL posted = _posted;
  [self request:posted ? @"GET" : @"POST" then:^(NSDictionary* body) { [self received:body posted:posted]; }];
}

- (void)received:(NSDictionary*)body posted:(BOOL)posted {
  if (![body[@"ok"] isEqual:@YES] || ![body[@"engine"] isKindOfClass:[NSDictionary class]]) {
    if (!posted) [self giveUp:@"extynt couldn't start learning here."];
    return;
  }
  _posted = YES;
  ExtyntCatalogueOutcome outcome = [_page render:body[@"engine"]];
  if (outcome == ExtyntCatalogueNoHosts) [self giveUp:@"No supported After Effects found."];
  if (outcome == ExtyntCatalogueFinished) [self end];
}

- (void)giveUp:(NSString*)why {
  [self end];
  [_page showGaveUp:why];
}

- (void)end {
  _ended = YES;
  [_timer invalidate];
  if (_page.footnote.length) _footnote.stringValue = _page.footnote;
  _retry.hidden = !_page.retryable;
  if (!_page.retryable)
    _closer = [NSTimer scheduledTimerWithTimeInterval:kSummarySeconds
                                               target:self
                                             selector:@selector(done:)
                                             userInfo:nil
                                              repeats:NO];
}

@end

int main(int argc, const char* argv[]) {
  @autoreleasepool {
    NSApplication* app = [NSApplication sharedApplication];
    ExtyntCatalogueController* controller = [[ExtyntCatalogueController alloc] init];
    app.delegate = controller;
    [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
    [app run];
  }
  return 0;
}

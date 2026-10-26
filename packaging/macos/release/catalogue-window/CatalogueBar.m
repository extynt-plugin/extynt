// The bar's timer, easing and drawing: see CatalogueBar.h.
#import "CatalogueBar.h"

#import "CatalogueTheme.h"

@implementation ExtyntBar {
  double _shown, _from, _to;
  NSTimeInterval _tweenStart, _clock;
  NSTimer* _frames;
}

- (BOOL)isFlipped {
  return YES;
}

- (void)viewDidMoveToWindow {
  [_frames invalidate];
  _frames = nil;
  if (!self.window) return;
  _frames = [NSTimer timerWithTimeInterval:1.0 / 60 target:self selector:@selector(step) userInfo:nil repeats:YES];
  [[NSRunLoop mainRunLoop] addTimer:_frames forMode:NSRunLoopCommonModes];
}

- (void)step {
  _clock = [NSDate timeIntervalSinceReferenceDate];
  double t = MIN(1, (_clock - _tweenStart) / 0.6);
  double eased = 1 - pow(1 - t, 3);
  double next = _from + (_to - _from) * eased;
  if (self.indeterminate || next != _shown) {
    _shown = next;
    self.needsDisplay = YES;
  }
}

- (void)setFraction:(double)fraction {
  _from = _shown;
  _to = MAX(0, MIN(1, fraction));
  _tweenStart = [NSDate timeIntervalSinceReferenceDate];
}

- (void)setIndeterminate:(BOOL)indeterminate {
  if (_indeterminate && !indeterminate) _shown = _from = 0;
  _indeterminate = indeterminate;
  self.needsDisplay = YES;
}

- (void)drawRect:(NSRect)dirty {
  NSRect inner = NSInsetRect(self.bounds, 2, 2);
  [ExtyntPaper() setFill];
  NSRectFill(self.bounds);
  [ExtyntText() setFill];
  NSFrameRectWithWidth(self.bounds, 1);
  if (self.indeterminate) {
    double phase = fmod(_clock / 1.4, 2.0), x = phase < 1 ? phase : 2 - phase;
    double eased = x < 0.5 ? 4 * x * x * x : 1 - pow(-2 * x + 2, 3) / 2;
    CGFloat width = NSWidth(inner) * 0.28;
    NSRectFill(NSMakeRect(NSMinX(inner) + (NSWidth(inner) - width) * eased, NSMinY(inner), width, NSHeight(inner)));
    return;
  }
  NSRectFill(NSMakeRect(NSMinX(inner), NSMinY(inner), round(NSWidth(inner) * _shown), NSHeight(inner)));
}

@end

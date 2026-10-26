// Canned engine statuses for previewing the "Learning your effects" page without a sidecar: the shapes
// GET /v1/catalogue/engine returns (apps/sidecar/src/catalogue-engine.ts), from waiting to a finished run where
// Remove Grain was skipped and After Effects 2025 could not start.
#import <Foundation/Foundation.h>

static NSDictionary* Host(NSString* year, NSString* state, NSString* phase, id result) {
  return @{@"year" : year, @"state" : state, @"phase" : phase, @"result" : result ?: [NSNull null]};
}

static NSDictionary* EndedHost(NSString* year, NSString* state, id result, NSString* reason) {
  return @{
    @"year" : year,
    @"state" : state,
    @"phase" : @"finished",
    @"result" : result ?: [NSNull null],
    @"reason" : reason
  };
}

static NSDictionary* WaitingNext(void) { return Host(@"2025", @"pending", @"waiting", nil); }

static NSDictionary* LearningCatalogue(void) {
  return @{
    @"installed" : @585,
    @"collected" : @312,
    @"pending" : @273,
    @"probedThisRun" : @300,
    @"totalProbeMs" : @270000
  };
}

static NSDictionary* NearlyCatalogue(void) {
  return
      @{@"installed" : @585,
        @"collected" : @540,
        @"pending" : @45,
        @"probedThisRun" : @528,
        @"totalProbeMs" : @475000};
}

static NSDictionary* LearnedResult(void) {
  return @{
    @"installed" : @585,
    @"collected" : @584,
    @"failed" : @1,
    @"needsSource" : @2,
    @"deferred" : @4,
    @"crashed" : @[ @"Remove Grain" ]
  };
}

static NSDictionary* Status(NSString* name, NSString* state, NSArray* hosts, NSDictionary* catalogue) {
  return @{@"name" : name, @"engine" : @{@"state" : state, @"hosts" : hosts, @"catalogue" : catalogue}};
}

NSArray<NSDictionary*>* ExtyntCannedStatuses(void) {
  return @[
    Status(@"1-waiting", @"running", @[ Host(@"2026", @"pending", @"waiting", nil), WaitingNext() ], @{}),
    Status(@"2-starting", @"running", @[ Host(@"2026", @"running", @"starting", nil), WaitingNext() ], @{}),
    Status(@"3-learning", @"running", @[ Host(@"2026", @"running", @"learning", nil), WaitingNext() ],
           LearningCatalogue()),
    Status(@"4-nearly", @"running", @[ Host(@"2026", @"running", @"learning", nil), WaitingNext() ], NearlyCatalogue()),
    Status(@"5-finished", @"done",
           @[ Host(@"2026", @"done", @"finished", LearnedResult()), Host(@"2025", @"failed", @"finished", nil) ], @{}),
    Status(@"6-timed-out", @"failed",
           @[ EndedHost(@"2026", @"failed", nil, @"hung"), EndedHost(@"2025", @"done", LearnedResult(), @"complete") ],
           @{}),
  ];
}

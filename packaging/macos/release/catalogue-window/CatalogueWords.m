// The words themselves; the phrases are the ones the page always used. See CatalogueWords.h.
#import "CatalogueWords.h"

NSString* ExtyntPlural(NSInteger count, NSString* word) {
  return [NSString stringWithFormat:@"%ld %@%@", (long)count, word, count == 1 ? @"" : @"s"];
}

NSInteger ExtyntIntOf(NSDictionary* dictionary, NSString* key) {
  id value = dictionary[key];
  return [value isKindOfClass:[NSNumber class]] ? [value integerValue] : 0;
}

NSDictionary* ExtyntResultOf(NSDictionary* host) {
  return [host[@"result"] isKindOfClass:[NSDictionary class]] ? host[@"result"] : nil;
}

NSString* ExtyntTimeLeft(NSDictionary* catalogue) {
  NSInteger probed = ExtyntIntOf(catalogue, @"probedThisRun"), pending = ExtyntIntOf(catalogue, @"pending"),
            probeMs = ExtyntIntOf(catalogue, @"totalProbeMs");
  if (probed < 20 || pending == 0 || probeMs == 0) return @"";
  double seconds = (double)pending * (double)probeMs / (double)probed / 1000.0;
  if (seconds < 60) return @" · under a minute left";
  return [NSString stringWithFormat:@" · about %@ left", ExtyntPlural((NSInteger)ceil(seconds / 60.0), @"minute")];
}

NSString* ExtyntFailurePhrase(id value) {
  NSString* reason = [value isKindOfClass:[NSString class]] ? value : @"";
  if ([@[ @"hung", @"stalled", @"time-limit" ] containsObject:reason]) return @"timed out";
  NSDictionary* words = @{
    @"start-failed" : @"didn't start",
    @"census-failed" : @"didn't answer",
    @"modal-blocked" : @"is blocked",
    @"crashed" : @"kept crashing",
    @"after-effects-open" : @"is open. Restart it to load extynt"
  };
  if (words[reason]) return words[reason];
  return [reason hasPrefix:@"paused"] ? @"paused" : @"didn't finish";
}

BOOL ExtyntRetryableReason(id value) {
  NSString* reason = [value isKindOfClass:[NSString class]] ? value : @"";
  return reason.length > 0 && ![reason isEqual:@"complete"] && ![reason isEqual:@"after-effects-open"];
}

NSString* ExtyntHostStatus(NSDictionary* host) {
  NSString* phase = host[@"phase"];
  if ([phase isEqual:@"waiting"] || [phase isEqual:@"starting"] || [phase isEqual:@"learning"]) return @"";
  if ([phase isEqual:@"restarting"]) return @"an effect crashed it. Restarting without it";
  if ([phase isEqual:@"reading-effects"]) return @"listing installed effects";
  NSDictionary* result = ExtyntResultOf(host);
  if (!result) return ExtyntFailurePhrase(host[@"reason"]);
  NSString* learned = [NSString stringWithFormat:@"%ld of %@ learned", (long)ExtyntIntOf(result, @"collected"),
                                                 ExtyntPlural(ExtyntIntOf(result, @"installed"), @"effect")];
  return [host[@"state"] isEqual:@"done"] ? learned : [learned stringByAppendingString:@". The rest later"];
}

ExtyntTagKind ExtyntKindOf(NSDictionary* host) {
  NSString* state = host[@"state"];
  if ([state isEqual:@"running"]) return ExtyntTagWorking;
  if ([state isEqual:@"done"] && ExtyntResultOf(host)) return ExtyntTagDone;
  if ([state isEqual:@"done"] || [state isEqual:@"failed"]) return ExtyntTagLater;
  return ExtyntTagWaiting;
}

NSString* ExtyntTagWord(NSDictionary* host) {
  NSDictionary* words = @{
    @"starting" : @"STARTING",
    @"restarting" : @"RESTARTING",
    @"reading-effects" : @"LISTING",
    @"learning" : @"LEARNING"
  };
  switch (ExtyntKindOf(host)) {
    case ExtyntTagWaiting: return @"WAITING";
    case ExtyntTagWorking: return words[host[@"phase"]] ?: @"STARTING";
    case ExtyntTagDone: return @"DONE";
    case ExtyntTagLater: return ExtyntResultOf(host) ? @"PARTLY" : @"LATER";
  }
}

static NSOrderedSet* CrashedNames(NSArray* hosts) {
  NSMutableOrderedSet* crashed = [NSMutableOrderedSet orderedSet];
  for (NSDictionary* host in hosts)
    for (id name in ExtyntResultOf(host)[@"crashed"]) [crashed addObject:name];
  return crashed;
}

static NSInteger DeferredCount(NSArray* hosts) {
  NSInteger later = 0;
  for (NSDictionary* host in hosts) {
    NSDictionary* result = ExtyntResultOf(host);
    if (result) later = MAX(later, ExtyntIntOf(result, @"deferred") + ExtyntIntOf(result, @"needsSource"));
  }
  return later;
}

static NSString* CrashedNote(NSOrderedSet* crashed) {
  NSArray* shown = [crashed.array subarrayWithRange:NSMakeRange(0, MIN(crashed.count, 3))];
  NSString* more =
      crashed.count > 3 ? [NSString stringWithFormat:@" and %lu more", (unsigned long)(crashed.count - 3)] : @"";
  return [NSString
      stringWithFormat:@"Skipped %@%@. %@ After Effects, so we leave %@ alone.", [shown componentsJoinedByString:@", "],
                       more, crashed.count == 1 ? @"It crashes" : @"They crash", crashed.count == 1 ? @"it" : @"them"];
}

NSString* ExtyntSkippedNote(NSArray* hosts) {
  NSOrderedSet* crashed = CrashedNames(hosts);
  NSInteger later = DeferredCount(hosts);
  NSMutableArray* parts = [NSMutableArray array];
  if (crashed.count > 0) [parts addObject:CrashedNote(crashed)];
  if (later > 0)
    [parts
        addObject:[NSString stringWithFormat:@"%@ need their own window or layer. Those get learned when you use them.",
                                             ExtyntPlural(later, @"effect")]];
  return [parts componentsJoinedByString:@" "];
}

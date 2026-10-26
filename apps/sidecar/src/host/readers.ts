// Card F2's surface for the host lane: everything that reads After Effects or does side work besides the writes. Card F1's
// composition creates one `HostReaders`, hands `events.onEvent` to the plugin connection, calls `register` on its runner
// registry, and asks `claimAhead` and `claimBackground` where it takes work from the sidecar's own queues.
import { jsonOf } from "@extynt/mcp-server";
import type { InProcessReceivers } from "../receiver-types.js";
import type { SidecarState } from "../server-state.js";
import { createHostEvents, realTimers, type EventTimers, type HostEvents } from "./events.js";
import { createFrameStore, type FrameStore } from "./frame-store.js";
import { createDetailsStore } from "./details-store.js";
import { createHashMemory, type HashMemory } from "./hash-memory.js";
import { profileDirectory } from "../profile-store.js";
import type { HostRunnerRegistry } from "./lane-types.js";
import { claimAhead, claimBackground, type ReadClaim } from "./read-claims.js";
import { createCaptureRunner } from "./run-capture.js";
import { createCensusRunner, queueCensus } from "./run-census.js";
import { runCatalogue } from "./run-catalogue.js";
import { runCollection } from "./run-collection.js";
import { createPreviewRunner } from "./run-preview.js";
import { createReadRunner } from "./run-read.js";
import { createThumbService, type ThumbService } from "./thumbs.js";
import { discardUiEvents, type FrameSide, type UiEventSink } from "./ui-events.js";

interface HostReadersDeps {
  state: SidecarState;
  receivers: InProcessReceivers;
  sink?: UiEventSink;
  thumbsEnabled?: () => boolean;
  timers?: EventTimers;
}

/**
 * What the lane composes. `events` takes plugin events in and puts focus and reads out; `frames` holds thumbnails and variant pictures for the UI
 * routes; `hashes` remembers what each stored snapshot's last read saw, so a write's reads fold onto it; `thumbs` makes before and after
 * thumbnails for a plan. `capturePlan` captures one for the stored plan (240 px, off the critical path; false when thumbnails are off or the plan
 * shows nothing a frame could show, and a "before" asked for ahead of the apply replaces the idle one and is skipped when the picture exists).
 * `register` adds the runners for `refresh_snapshot`, `capture_frame`, `collection_page`, `catalogue_page`, `preview_controls` and `host_census`.
 * `claimAhead` is a bounded collection page, ahead of the mailbox; `claimBackground` a pending thumbnail, then a catalogue page, only when the
 * mailbox is empty and nothing runs. `afterPair` forgets what the last connection taught and asks the scheduler for the first read; `queueCensus`
 * queues a census; `onRead` listens for each finished read of the project, whether or not it landed.
 */
export interface HostReaders {
  events: HostEvents;
  frames: FrameStore;
  hashes: HashMemory;
  thumbs: ThumbService;
  capturePlan(planId: string, side: FrameSide, urgency?: "idle" | "ahead"): boolean;
  register(registry: HostRunnerRegistry): void;
  claimAhead(now: number): ReadClaim | undefined;
  claimBackground(now: number): ReadClaim | undefined;
  afterPair(): void;
  queueCensus(): boolean;
  onRead(listener: () => void): void;
}

export function createHostReaders(deps: HostReadersDeps): HostReaders {
  const { state } = deps, sink = deps.sink ?? discardUiEvents, hashes = createHashMemory(createDetailsStore({ directory: state.options.stateDirectory ?? profileDirectory() })), frames = createFrameStore(sink);
  const events = createHostEvents({ state, receivers: deps.receivers, sink, ...(deps.timers ? { timers: deps.timers } : {}) });
  const thumbs = createThumbService({ state, ...(deps.thumbsEnabled ? { enabled: deps.thumbsEnabled } : {}) });
  const askForCensus = (): boolean => queueCensus(state);
  const readListeners: Array<() => void> = [];
  const scanAfterRead = (): void => { events.scan(); for (const listener of readListeners) listener(); };
  return {
    events, frames, thumbs, hashes,
    register(registry) {
      registry.register("refresh_snapshot", createReadRunner({ hashes, scan: scanAfterRead, queueCensus: askForCensus }));
      registry.register("capture_frame", createCaptureRunner({ frames }));
      registry.register("collection_page", runCollection);
      registry.register("catalogue_page", runCatalogue);
      registry.register("preview_controls", createPreviewRunner({ frames }));
      registry.register("host_census", createCensusRunner(deps.timers ?? realTimers));
    },
    capturePlan(planId, side, urgency) {
      const record = state.plans.get(planId);
      if (!record) return false;
      if (side === "before" && urgency === "ahead") { thumbs.drop(planId, side); if (frames.thumbsFor(planId)?.before) return true; }
      return thumbs.queue({ planId, side, operations: jsonOf(record.plan.operations), ...(urgency ? { urgency } : {}) });
    },
    claimAhead: (now) => claimAhead(state, now),
    claimBackground: (now) => claimBackground(state, now, thumbs),
    afterPair() { hashes.reset(); events.reset(); events.scan(); },
    queueCensus: askForCensus,
    onRead(listener) { readListeners.push(listener); },
  };
}

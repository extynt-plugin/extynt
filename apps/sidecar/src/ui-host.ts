// The seam between the UI routes and the native host lane (Card F2's readers): the event sink the lane publishes to, the
// thumbnail preference it reads, and the frames and census the routes answer from. Card F1's composition binds them.
import type { FrameStore } from "./host/frame-store.js";
import type { UiEvent as LaneEvent, UiEventSink } from "./host/ui-events.js";
import type { SidecarState } from "./server-state.js";
import { uiEventsFor } from "./ui-events.js";
import { uiStoreFor } from "./ui-store.js";

interface UiHostReaders { frames: Pick<FrameStore, "thumbsFor" | "previewFor">; queueCensus(): boolean }

const bound = new WeakMap<WeakKey, UiHostReaders>();

export function bindUiHost(state: WeakKey, readers: UiHostReaders): void { bound.set(state, readers); }
export function uiHostOf(state: WeakKey): UiHostReaders | null { return bound.get(state) ?? null; }

/** The user's "Before/after frames" preference, for `createHostReaders({ thumbsEnabled })`. */
export function thumbsEnabledFor(state: Pick<SidecarState, "options" | "now">): () => boolean {
  return () => uiStoreFor(state).prefs().showThumbnails;
}

function wireEvent(event: LaneEvent): { type: "change"; seq: number; reason: string } | { type: "thumbs"; planId: string } | { type: "preview"; setId: string } | { type: "poke" } {
  if (event.type === "change") return { type: "change", seq: 0, reason: event.change.reasons.join(",") || "project" };
  if (event.type === "thumb") return { type: "thumbs", planId: event.planId };
  if (event.type === "preview") return { type: "preview", setId: event.setId };
  return { type: "poke" };
}

/** The sink for `createHostReaders({ sink })`: lane events become the panel's stream events; a focus report only re-derives the focus view. */
export function uiEventSinkFor(state: WeakKey): UiEventSink {
  const hub = uiEventsFor(state);
  return { publish: (event) => hub.publish(wireEvent(event)) };
}

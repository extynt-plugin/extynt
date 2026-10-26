// Thumbnails and variant pictures the lane has made, held in memory for the UI to read (`GET /v1/thumbs/:planId`,
// `POST /v1/variants/:setId/preview`). Bounded and per process: a restart forgets them, and a frame is cheap to take again.
import type { FrameSide, UiEventSink } from "./ui-events.js";
import { discardUiEvents } from "./ui-events.js";
import type { Thumbnail } from "./frame-pipeline.js";

const MAX_PLANS = 64, MAX_SETS = 16;

/** What a variant preview produced: `ready` holds one PNG data URL per candidate index, `none` means the host had nothing to picture, and `unresolved` means the control may not be back at its original value so native access is held. */
export type PreviewResult =
  | { status: "ready"; pictures: Record<number, string> }
  | { status: "none" }
  | { status: "unresolved"; code: string };

export interface FrameStore {
  putThumb(planId: string, side: FrameSide, thumb: Thumbnail): void;
  thumbsFor(planId: string): { before?: Thumbnail; after?: Thumbnail } | undefined;
  putPreview(setId: string, result: PreviewResult): void;
  previewFor(setId: string): PreviewResult | undefined;
}

function remember<V>(map: Map<string, V>, key: string, value: V, limit: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > limit) { const oldest = map.keys().next().value; if (typeof oldest === "string") map.delete(oldest); else break; }
}

export function createFrameStore(sink: UiEventSink = discardUiEvents): FrameStore {
  const thumbs = new Map<string, { before?: Thumbnail; after?: Thumbnail }>(), previews = new Map<string, PreviewResult>();
  return {
    putThumb(planId, side, thumb) {
      remember(thumbs, planId, { ...thumbs.get(planId), [side]: thumb }, MAX_PLANS);
      sink.publish({ type: "thumb", planId, side });
    },
    thumbsFor: (planId) => thumbs.get(planId),
    putPreview(setId, result) {
      remember(previews, setId, result, MAX_SETS);
      sink.publish({ type: "preview", setId });
    },
    previewFor: (setId) => previews.get(setId),
  };
}

// What the host lane tells the UI over the SSE route: focus, change, thumbnail and preview notices. Every payload is small and bounded.
import type { ChangeReason } from "@extynt/host-native";
import type { FocusContext } from "../focus-overlay.js";

export type FrameSide = "before" | "after";

/** The open project, composition, selection (with up to eight layer names) or time changed (`focus`); the project's revision, epoch or item count moved (`change`); a plan's before or after thumbnail is ready (`thumb`); a variant set's pictures are ready (`preview`). */
export type UiEvent =
  | { type: "focus"; focus: FocusContext }
  | { type: "change"; change: { epoch: number; revision: number | null; items: number | null; projectName: string; reasons: ChangeReason[] } }
  | { type: "thumb"; planId: string; side: FrameSide }
  | { type: "preview"; setId: string };

export interface UiEventSink { publish(event: UiEvent): void }

/** The sink for a lane nobody listens to. */
export const discardUiEvents: UiEventSink = { publish: () => undefined };

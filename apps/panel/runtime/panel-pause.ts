/**
 * "Paused after N steps — Continue": what a pause at the automatic window cap says, and when its button may be used.
 * Derived only from what the sidecar reports and what the transcript holds, so every case is testable without a DOM.
 * A Continue belongs to the job it was drawn for and to the end of the conversation: once the user says anything else,
 * or a turn is running, it cannot send anything.
 */
import type { Decoder, Infer } from "@extynt/decode";
import type { TranscriptRow } from "./transcript.js";
import { brand, fallback, literal, number, object, string } from "@extynt/decode";

const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Accepts a pause marker: the kind, a whole step count and the job a Continue resumes. */
export const pauseDecoder = object({
  kind: literal("window-cap"),
  steps: number({ int: true, min: 1 }),
  jobId: brand<"JobId", string>("JobId", string({ pattern: JOB_ID })),
});

/** The pause at the automatic step cap, naming the job whose Continue it offers. */
export type WindowCapPause = Infer<typeof pauseDecoder>;

/** The sidecar's pause marker, or null for anything that is not one (an older sidecar, another kind, a bad shape). */
export const pauseOrNull: Decoder<WindowCapPause | null> = fallback(pauseDecoder, null);

type PauseControl = "ready" | "busy" | "stale";

/** Exactly what typing the word sends, so the sidecar's own same-job reopening applies. */
export const CONTINUE_MESSAGE = "continue";

/** What identifies a pause card: the job it belongs to and the step count it paused at. */
export function pauseKey(pause: WindowCapPause): string {
  return pause.jobId + ":" + pause.steps;
}

/** Whether this card's button may send, from the transcript being shown and whether a turn is running. */
export function pauseControl(rows: ReadonlyArray<TranscriptRow>, row: TranscriptRow, busy: boolean): PauseControl {
  const at = rows.indexOf(row);
  if (at < 0) return "stale";
  if (rows.slice(at + 1).some((later) => later.kind === "user")) return "stale";
  return busy ? "busy" : "ready";
}

/** What the status poll has told the panel so far: whether it has looked once, and the pause it last saw. */
export interface PauseWatch {
  readonly polled: boolean;
  readonly seen: string | null;
}

interface PauseWatchContext {
  readonly busy: boolean;
  readonly shown: ReadonlyArray<TranscriptRow>;
}

function isOnCard(shown: ReadonlyArray<TranscriptRow>, key: string | null): boolean {
  return shown.some((row) => row.kind === "assistant" && row.pause !== undefined && pauseKey(row.pause) === key);
}

/**
 * A pause the panel should announce on its own: one that appeared after the first poll (the cap was hit while the
 * panel was open) and is not already on a card. The first poll only records what was already paused when the panel
 * started, so reopening the panel never replays an old job. While a turn is running the reply carries its own
 * pause, so the poll waits instead of recording.
 */
export function watchPause(watch: PauseWatch, pause: WindowCapPause | null, context: PauseWatchContext): { watch: PauseWatch; announce: WindowCapPause | null } {
  const key = pause ? pauseKey(pause) : null;
  if (!watch.polled) return { watch: { polled: true, seen: key }, announce: null };
  if (key === watch.seen || context.busy) return { watch, announce: null };
  const announce = pause && !isOnCard(context.shown, key) ? pause : null;
  return { watch: { polled: true, seen: key }, announce };
}

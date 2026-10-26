/** The chat turn the panel has open: whether one runs, the request that carries it, and what its progress reports so far. */
import type { TransportContext } from "./panel-transport.js";
import type { TokenUsage } from "./transcript.js";

let running = false;
let active: TransportContext | null = null;
let usage: TokenUsage | null = null;
let steps = 0;

/** Whether a turn is running, from this panel or followed from the sidecar. */
export function isChatInFlight(): boolean {
  return running;
}

/** Records whether a turn is running. */
export function setChatInFlight(value: boolean): void {
  running = value;
}

/** The request of the turn this panel sent, while it is open. */
export function activeTurn(): TransportContext | null {
  return active;
}

/** Records the request of the open turn, or none. */
export function setActiveTurn(context: TransportContext | null): void {
  active = context;
}

/** What the turn's progress reported so far: the tokens it spent and the step it reached. */
export function turnProgress(): { readonly usage: TokenUsage | null; readonly steps: number } {
  return { usage, steps };
}

/** Folds one progress report into what the turn is known to have spent. */
export function noteTurnProgress(reported: TokenUsage | null, step: number): void {
  if (reported && reported.totalTokens) usage = reported;
  if (step > steps) steps = step;
}

/** Forgets what the last turn spent. */
export function resetTurnProgress(): void {
  usage = null;
  steps = 0;
}

/** Aborts the open request; false when there is none or it had already ended. */
export function abortActiveTurn(reason?: string): boolean {
  const xhr = active?.xhr;
  if (!active || !xhr) return false;
  if (reason) active.abortReason = reason;
  try {
    xhr.abort();
    return true;
  } catch {
    return false;
  }
}

// The refusal every validator and analyser returns instead of throwing.

/** A request or frame that was turned away, with a stable code and a sentence a reader can act on. */
export interface Refusal {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
}

/** Builds the refusal for a code and message. */
export function refusal(code: string, message: string): Refusal {
  return { ok: false, code, message };
}

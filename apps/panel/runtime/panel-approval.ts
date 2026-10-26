/** The design brief waiting for a yes: the marker the sidecar puts on the reply that shows it, what the Build button says for the reader, and when that button may be used. */
import type { Decoder, Infer } from "@extynt/decode";
import type { TranscriptRow } from "./transcript.js";
import { fallback, literal, object } from "@extynt/decode";

/** Accepts the marker on a reply that ended by showing the design for approval. */
export const approvalDecoder = object({ kind: literal("design-brief") });

type DesignApproval = Infer<typeof approvalDecoder>;

/** The sidecar's approval marker, or null for anything that is not one. */
export const approvalOrNull: Decoder<DesignApproval | null> = fallback(approvalDecoder, null);

/** Whether the newest reply is a design waiting for approval that nothing has answered yet. */
export function approvalWaiting(rows: ReadonlyArray<TranscriptRow>, busy: boolean): boolean {
  if (busy) return false;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row?.kind === "user") return false;
    if (row?.kind === "assistant") return row.approval !== undefined;
  }
  return false;
}

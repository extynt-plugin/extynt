// The progress rows the host reports while it creates an effect, kept only when they form the exact attempted/observed sequence.
import { array, decode, number, optional, strictObject, string } from "@extynt/decode";
import type { Infer, JsonValue } from "@extynt/decode";

const ORDER = ["add-effect", "enabled", "control-1", "control-2", "control-3"];

const evidenceRow = strictObject({ action: string(), state: string(), effectIndex: optional(number({ int: true, min: 1, max: 16 })) });
const evidenceRows = array(evidenceRow, { minLength: 1, maxLength: 10 });

export type CreationEvidence = Infer<typeof evidenceRow>;

function inSequence(row: CreationEvidence, index: number): boolean {
  const stateNow = index % 2 ? "observed" : "attempted";
  return row.action === ORDER[Math.floor(index / 2)] && row.state === stateNow && (row.effectIndex === undefined || index === 1);
}

/** The reported rows when there are one to ten of them in order and only the second may name an effect index; otherwise undefined. */
export function boundedCreationEvidence(value: JsonValue | undefined): ReadonlyArray<CreationEvidence> | undefined {
  const decoded = decode(evidenceRows, value);
  return decoded.ok && decoded.value.every(inSequence) ? decoded.value : undefined;
}

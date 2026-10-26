// The stored form of a note or usage value: one finite number or two to four of them, as JSON text.
import { array, decodeJson, map, number, union } from "@extynt/decode";
import type { NoteValue } from "./effect-notes-types.js";

const VECTOR_LENGTH = { minLength: 2, maxLength: 4 } as const;

/** One finite number, or two to four of them; anything else is refused rather than coerced. */
export const noteValueDecoder = union(number(), map(array(number(), VECTOR_LENGTH), (numbers): number[] => [...numbers]));

const storedValue = union(number(), map(array(number()), (numbers): number[] => [...numbers]));

/** A value as the text stored beside a note or usage row. */
export function valueText(value: NoteValue): string {
  return JSON.stringify(value);
}

/** A stored value text back to its value; null when it is absent or no longer a valid value. */
export function parseValueText(text: string | null): NoteValue | null {
  if (text === null) return null;
  const decoded = decodeJson(text, storedValue);
  return decoded.ok ? decoded.value : null;
}

/** Whether two id sets hold exactly the same ids. */
export function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((id) => right.has(id));
}

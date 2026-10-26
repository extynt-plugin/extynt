// Builds concept-table triggers from word lists: the words of each list are alternatives, and a few words (or characters) may sit between one list and the next.
import { hasCjk } from "./resolution-text.js";

const ALTERNATIVE = "|";

function alternatives(list: string, cjk: boolean): string {
  return list.split(", ").filter((word) => hasCjk(word) === cjk).join(ALTERNATIVE);
}

/** One trigger per script (Latin words, then kana and ideographs) that holds a word of each comma-separated list in the order given, with a gap allowed between them; a script some list has no word of gets none. */
export function chain(...lists: ReadonlyArray<string>): string {
  const scripts = [false, true].map((cjk) => lists.map((list) => alternatives(list, cjk)));
  return scripts.filter((parts) => parts.every((part) => part !== "")).map((parts) => parts.join(" * ")).join(", ");
}

/** The triggers for a word of the first list and a word of the second in either order. */
export function across(first: string, second: string): string {
  return `${chain(first, second)}, ${chain(second, first)}`;
}

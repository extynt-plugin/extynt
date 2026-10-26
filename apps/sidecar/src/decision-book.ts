// The book of settled decisions: answers a decision model gave for a piece of request text, kept so the synchronous seams that read the text later find them; a text with no entry is answered by the seam's own deterministic function.
import { createHash } from "node:crypto";

type Booked = boolean | string;

const BOOK_LIMIT = 512;

const book = new Map<string, Booked>();

const flatten = (text: string): string => text.replace(/\s+/g, " ").trim();

function keyOf(decision: string, text: string, item: string): string {
  return `${decision}\u0000${createHash("sha256").update(flatten(text)).digest("hex").slice(0, 24)}\u0000${item}`;
}

function put(decision: string, text: string, item: string, answer: Booked): void {
  const [oldest] = book.keys();
  if (book.size >= BOOK_LIMIT && oldest !== undefined) book.delete(oldest);
  book.set(keyOf(decision, text, item), answer);
}

/** Books a yes or no answer for a decision about a text, optionally about one item of it (a feature id, a name). */
export function bookYesNo(entry: { readonly decision: string; readonly text: string; readonly item?: string }, answer: boolean): void {
  put(entry.decision, entry.text, entry.item ?? "", answer);
}

/** Books the label a choice decision picked for a text. */
export function bookLabel(entry: { readonly decision: string; readonly text: string }, label: string): void {
  put(entry.decision, entry.text, "", label);
}

/** The booked yes or no answer, or undefined when the decision was never settled for this text by a model. */
export function bookedYesNo(entry: { readonly decision: string; readonly text: string; readonly item?: string }): boolean | undefined {
  const answer = book.get(keyOf(entry.decision, entry.text, entry.item ?? ""));
  return typeof answer === "boolean" ? answer : undefined;
}

/** The booked label of a choice decision when it is one of the given labels, or undefined when none was settled for this text by a model. */
export function bookedOneOf<Label extends string>(entry: { readonly decision: string; readonly text: string }, labels: ReadonlyArray<Label>): Label | undefined {
  const answer = book.get(keyOf(entry.decision, entry.text, ""));
  return labels.find((label) => label === answer);
}

/** Forgets every booked answer; tests start from an empty book. */
export function clearBook(): void {
  book.clear();
}

/** The booked text of a decision, or undefined when none was booked. */
export function bookedText(entry: { readonly decision: string; readonly text: string }): string | undefined {
  const answer = book.get(keyOf(entry.decision, entry.text, ""));
  return typeof answer === "string" ? answer : undefined;
}

const BAND_ITEM = "~band";

/** Books the confidence band a model answer to a decision about a text was taken in (act or verify). */
export function bookBand(entry: { readonly decision: string; readonly text: string }, band: string): void {
  put(entry.decision, entry.text, BAND_ITEM, band);
}

/** The band a booked answer was taken in, or undefined when none was booked. */
export function bookedBand(entry: { readonly decision: string; readonly text: string }): string | undefined {
  const answer = book.get(keyOf(entry.decision, entry.text, BAND_ITEM));
  return typeof answer === "string" ? answer : undefined;
}

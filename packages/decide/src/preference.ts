// The preference tally: how often the user kept, undid or swapped a choice, as pure scoring over a store the host application persists.
import { number, object, record, string } from "@extynt/decode";
import type { Infer } from "@extynt/decode";

/** The tally of one thing the user can habitually pick: effect, font, control, property or control value. */
export const preferenceRecord = object({ uses: number({ min: 0 }), undos: number({ min: 0 }), replaced: number({ min: 0 }), lastUsedAt: number({ min: 0 }) });

/** The decoder for a whole tally store: a record per key. */
export const preferenceStore = record(string(), preferenceRecord);

/** The tally of one thing. */
export type PreferenceRecord = Infer<typeof preferenceRecord>;

/** Every tally, by key. */
export type PreferenceStore = Infer<typeof preferenceStore>;

/** What happened to a choice: it was applied and kept, undone straight after, or swapped for another within the same plan. */
export type PreferenceSignal = "use" | "undo" | "replace";

/** The days after which a tally counts half as much. */
export const PREFERENCE_HALF_LIFE_DAYS = 30;

const DAY_MS = 86_400_000;

const EMPTY: PreferenceRecord = { uses: 0, undos: 0, replaced: 0, lastUsedAt: 0 };

/** The store key of a thing: its kind and the parts that identify it, such as `effect:ADBE Glo2` or `control:ADBE Glo2/ADBE Glo2-0003`. */
export function preferenceKey(kind: "effect" | "font" | "control" | "property" | "value", ...parts: ReadonlyArray<string>): string {
  return `${kind}:${parts.join("/")}`;
}

/** The store with the signal counted for the key at the given time (milliseconds since the epoch); the store given is not changed. */
export function recordSignal(store: PreferenceStore, key: string, signal: PreferenceSignal, now: number): PreferenceStore {
  const before = Object.hasOwn(store, key) ? store[key] ?? EMPTY : EMPTY;
  const after = {
    uses: before.uses + (signal === "use" ? 1 : 0),
    undos: before.undos + (signal === "undo" ? 1 : 0),
    replaced: before.replaced + (signal === "replace" ? 1 : 0),
    lastUsedAt: signal === "use" ? now : before.lastUsedAt,
  };
  return { ...store, [key]: after };
}

/** How strongly the user prefers a thing: uses less twice the undos and the swaps, halved every 30 days since it was last used, never below zero. */
export function preferenceScore(tally: PreferenceRecord, now: number): number {
  const raw = tally.uses - 2 * tally.undos - tally.replaced;
  const ageDays = Math.max(0, now - tally.lastUsedAt) / DAY_MS;
  return Math.max(0, raw * 0.5 ** (ageDays / PREFERENCE_HALF_LIFE_DAYS));
}

/** The score of each key that has a tally; keys with no tally are left out. */
export function preferenceScores(store: PreferenceStore, keys: ReadonlyArray<string>, now: number): Readonly<Record<string, number>> {
  return Object.fromEntries(keys.flatMap((key) => (Object.hasOwn(store, key) && store[key] !== undefined ? [[key, preferenceScore(store[key] ?? EMPTY, now)]] : [])));
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** A short sentence a decision model can read about a tally ("used 14 times, last 2 days ago, undone twice"), or null when the thing was never used. */
export function preferenceSummary(tally: PreferenceRecord | undefined, now: number): string | null {
  if (tally === undefined || tally.uses === 0) return null;
  const days = Math.floor(Math.max(0, now - tally.lastUsedAt) / DAY_MS);
  const when = days === 0 ? "today" : `${plural(days, "day")} ago`;
  const undone = tally.undos + tally.replaced > 0 ? `, undone or swapped ${plural(tally.undos + tally.replaced, "time")}` : "";
  return `the user used it ${plural(tally.uses, "time")}, last ${when}${undone}`;
}

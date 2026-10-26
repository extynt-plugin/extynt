// Animation habits: one bounded sample per animated property of a verified plan, and the median span, count and easing computed from them.
import { nullable, number, object, string } from "@extynt/decode";
import type { DatabaseSync } from "node:sqlite";
import { execute, selectAll } from "./graph-sql.js";
import type { HabitSampleRecord } from "./effect-notes-input.js";
import { claimKeptPlan } from "./effect-notes-usage.js";
import type { AnimationHabits, HabitKind } from "./effect-notes-types.js";

const HABIT_SAMPLE_ROWS = 4000;
/** At most this many samples per property kind. */
export const HABIT_SAMPLES_PER_KIND = 200;
/** A median or a most-common choice is only offered from this many samples. */
export const HABIT_MIN_SAMPLES = 3;
const MAX_KINDS = 8;
const MIN_KEYFRAMES = 2;

const sampleRow = object({ property_kind: string(), duration: number(), keyframes: number(), easing: string(), influence: nullable(number()), recorded_at: number() });

interface HabitRow { kind: string; duration: number; keyframes: number; easing: string; influence: number | null; at: number }

/** One animated property of a verified plan: once per (plan, slot). A plan already undone records nothing. */
export function recordHabitSample(database: DatabaseSync, sample: HabitSampleRecord): boolean {
  const at = sample.at ?? Date.now();
  if (!claimKeptPlan(database, sample.planId, at)) return false;
  execute(database, `INSERT INTO animation_habit_samples(plan_id,slot,property_kind,duration,keyframes,easing,influence,recorded_at) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(plan_id,slot) DO UPDATE SET property_kind=excluded.property_kind,duration=excluded.duration,keyframes=excluded.keyframes,easing=excluded.easing,influence=excluded.influence,recorded_at=excluded.recorded_at`,
  sample.planId, sample.slot, sample.propertyKind, sample.duration, sample.keyframes, sample.easing, sample.influence, at);
  execute(database, `DELETE FROM animation_habit_samples WHERE id IN (SELECT id FROM animation_habit_samples WHERE property_kind=? ORDER BY recorded_at DESC,id DESC LIMIT -1 OFFSET ${HABIT_SAMPLES_PER_KIND})`, sample.propertyKind);
  return true;
}

/** Global bound; called once per batch rather than once per sample. */
export function trimHabitSamples(database: DatabaseSync): void {
  execute(database, `DELETE FROM animation_habit_samples WHERE id IN (SELECT id FROM animation_habit_samples ORDER BY recorded_at DESC,id DESC LIMIT -1 OFFSET ${HABIT_SAMPLE_ROWS})`);
}

/** Undo and Forget: the plan's samples, or every sample. */
export function removeHabitSamples(database: DatabaseSync, planId?: string): number {
  return planId === undefined ? execute(database, "DELETE FROM animation_habit_samples") : execute(database, "DELETE FROM animation_habit_samples WHERE plan_id=?", planId);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2), upper = sorted[middle] ?? 0, lower = sorted[middle - 1] ?? upper;
  return sorted.length % 2 === 1 ? upper : (lower + upper) / 2;
}

/** Seconds as a person would say them: to 0.05 s under a second, 0.1 s under ten, half a second above. Never zero. */
export function roundSeconds(seconds: number): number {
  if (seconds < 1) return Math.max(0.05, Math.round(seconds * 20) / 20);
  return seconds < 10 ? Math.round(seconds * 10) / 10 : Math.round(seconds * 2) / 2;
}

/** The most common value; ties go to the one used most recently, then alphabetically, so the answer never flips on row order. */
export function mostCommon(rows: ReadonlyArray<{ value: string; at: number }>): string | undefined {
  const tally = new Map<string, { count: number; at: number }>();
  for (const row of rows) {
    const seen = tally.get(row.value);
    tally.set(row.value, { count: (seen?.count ?? 0) + 1, at: Math.max(seen?.at ?? 0, row.at) });
  }
  return [...tally].sort(([a, x], [b, y]) => y.count - x.count || y.at - x.at || (a < b ? -1 : 1))[0]?.[0];
}

function bezierInfluence(rows: readonly HabitRow[], easing: string): number | null {
  const influences = rows.flatMap((row) => (row.easing === "bezier" && row.influence !== null ? [row.influence] : []));
  return easing === "bezier" && influences.length >= HABIT_MIN_SAMPLES ? Math.round(median(influences)) : null;
}

function summary(rows: readonly HabitRow[]): Omit<HabitKind, "kind"> {
  const easing = mostCommon(rows.map((row) => ({ value: row.easing, at: row.at }))) ?? "default";
  return {
    samples: rows.length, medianSeconds: roundSeconds(median(rows.map((row) => row.duration))), easing,
    keyframes: Math.max(MIN_KEYFRAMES, Math.round(median(rows.map((row) => row.keyframes)))), influence: bezierInfluence(rows, easing),
  };
}

function groupedByKind(rows: readonly HabitRow[]): ReadonlyMap<string, HabitRow[]> {
  const groups = new Map<string, HabitRow[]>();
  for (const row of rows) groups.set(row.kind, [...(groups.get(row.kind) ?? []), row]);
  return groups;
}

/** What the user's kept animations usually look like: per property kind and overall, each only from at least three samples. Null when there is nothing to say. */
export function computeHabits(rows: readonly HabitRow[]): AnimationHabits | null {
  const kinds: HabitKind[] = [...groupedByKind(rows)].filter(([, group]) => group.length >= HABIT_MIN_SAMPLES).map(([kind, group]) => ({ kind, ...summary(group) }))
    .sort((a, b) => b.samples - a.samples || (a.kind < b.kind ? -1 : 1)).slice(0, MAX_KINDS);
  const overall = rows.length >= HABIT_MIN_SAMPLES ? summary(rows) : null;
  return overall === null && kinds.length === 0 ? null : { overall, kinds };
}

/** Computed on read from the bounded samples; never counts toward a note cap and never authorizes anything. */
export function readHabits(database: DatabaseSync): AnimationHabits | null {
  const rows = selectAll(database, `SELECT property_kind,duration,keyframes,easing,influence,recorded_at FROM animation_habit_samples ORDER BY recorded_at DESC,id DESC LIMIT ${HABIT_SAMPLE_ROWS}`, sampleRow);
  return computeHabits(rows.map((row) => ({ kind: row.property_kind, duration: row.duration, keyframes: row.keyframes, easing: row.easing, influence: row.influence, at: row.recorded_at })));
}

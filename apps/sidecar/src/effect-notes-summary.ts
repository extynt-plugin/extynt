// The counts behind the Memory settings line "Learned so far".
import { number, object, string } from "@extynt/decode";
import type { DatabaseSync } from "node:sqlite";
import { selectAll } from "./graph-sql.js";
import { readHabits } from "./effect-notes-habits.js";
import type { LearnedSummary } from "./effect-notes-types.js";

const countRow = object({ kind: string(), names: number() });

/** What has been learned so far: distinct effects, fonts and presets, and the median animation span once there are enough samples. Whatever is stored, whether or not learning is on now. */
export function learnedSummary(database: DatabaseSync): LearnedSummary {
  const counts = new Map(selectAll(database, "SELECT kind,COUNT(DISTINCT name) AS names FROM effect_usage_events GROUP BY kind", countRow).map((row) => [row.kind, row.names]));
  return { effects: counts.get("effect") ?? 0, fonts: counts.get("font") ?? 0, presets: counts.get("preset") ?? 0, animationSeconds: readHabits(database)?.overall?.medianSeconds ?? null };
}

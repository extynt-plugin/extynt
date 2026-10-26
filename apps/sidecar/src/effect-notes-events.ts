// Usage events: which effects, fonts and presets a verified plan used or a snapshot showed, and the ranking computed from them.
import { number, object, string } from "@extynt/decode";
import type { DatabaseSync } from "node:sqlite";
import { execute, selectAll } from "./graph-sql.js";
import { currentHostKey } from "./effect-notes-effect.js";
import type { KeptEventRecord, SeenEventRecord } from "./effect-notes-input.js";
import { claimKeptPlan } from "./effect-notes-usage.js";
import type { EffectUsageRank, UsageKind, UsageRank } from "./effect-notes-types.js";

const USAGE_EVENT_ROWS = 20000;
/** At most this many events per (kind, name, source). */
export const USAGE_EVENTS_PER_NAME = 1000;
const RANK_LIMIT = { min: 1, max: 1000 } as const;
const RANK_SQL = `SELECT name,COUNT(DISTINCT CASE WHEN source='kept' THEN plan_id END) AS kept,SUM(source='seen') AS seen FROM effect_usage_events WHERE kind=? GROUP BY name
  ORDER BY COUNT(DISTINCT CASE WHEN source='kept' THEN plan_id END)+SUM(source='seen') DESC,COUNT(DISTINCT CASE WHEN source='kept' THEN plan_id END) DESC,name LIMIT ?`;

const nameRow = object({ match_name: string(), display_name: string() });
const rankRow = object({ name: string(), kept: number(), seen: number() });

function boundedName(database: DatabaseSync, input: { kind: UsageKind; name: string; source: "kept" | "seen" }): void {
  execute(database, `DELETE FROM effect_usage_events WHERE id IN (SELECT id FROM effect_usage_events WHERE kind=? AND name=? AND source=? ORDER BY recorded_at DESC,id DESC LIMIT -1 OFFSET ${USAGE_EVENTS_PER_NAME})`, input.kind, input.name, input.source);
}

/** Global bound; called once per batch rather than once per event. */
export function trimEvents(database: DatabaseSync): void {
  execute(database, `DELETE FROM effect_usage_events WHERE id IN (SELECT id FROM effect_usage_events ORDER BY recorded_at DESC,id DESC LIMIT -1 OFFSET ${USAGE_EVENT_ROWS})`);
}

/** A plan used this effect, font or preset: once per (plan, kind, name, slot). A plan already undone records nothing. */
export function recordKeptEvent(database: DatabaseSync, record: KeptEventRecord): boolean {
  const at = record.at ?? Date.now();
  if (!claimKeptPlan(database, record.planId, at)) return false;
  execute(database, `INSERT INTO effect_usage_events(kind,name,source,plan_id,slot,recorded_at) VALUES(?,?,'kept',?,?,?)
    ON CONFLICT(plan_id,kind,name,slot) WHERE source='kept' DO UPDATE SET recorded_at=excluded.recorded_at`, record.kind, record.name, record.planId, record.slot, at);
  boundedName(database, { kind: record.kind, name: record.name, source: "kept" });
  return true;
}

/** Seen on a layer in an accepted snapshot; the key makes a re-read a refresh. */
export function recordSeenEvent(database: DatabaseSync, record: SeenEventRecord): boolean {
  execute(database, `INSERT INTO effect_usage_events(kind,name,source,plan_id,slot,recorded_at) VALUES(?,?,'seen',NULL,?,?)
    ON CONFLICT(kind,name,slot) WHERE source='seen' DO UPDATE SET recorded_at=excluded.recorded_at`, record.kind, record.name, record.key, record.at ?? Date.now());
  boundedName(database, { kind: record.kind, name: record.name, source: "seen" });
  return true;
}

function displayNames(database: DatabaseSync): ReadonlyMap<string, string> {
  const host = currentHostKey(database);
  if (!host) return new Map();
  return new Map(selectAll(database, "SELECT match_name,display_name FROM installed_effects WHERE host_key=?", nameRow, host).map((row) => [row.match_name, row.display_name]));
}

function presetLabel(name: string): string {
  return (name.split(/[/:]/).pop() ?? name).replace(/\.ffx$/i, "") || name;
}

function labelOf(kind: UsageKind, name: string, names: ReadonlyMap<string, string>): string {
  if (kind === "preset") return presetLabel(name);
  return names.get(name) ?? name;
}

/** The most-used names of one kind: kept (distinct plans) plus seen (distinct layers), best first. Computed on read from the bounded events. */
export function rankedUsage(database: DatabaseSync, input: { kind: UsageKind; limit: number }): UsageRank[] {
  const names = input.kind === "effect" ? displayNames(database) : new Map<string, string>();
  const limit = Math.max(RANK_LIMIT.min, Math.min(RANK_LIMIT.max, Math.floor(input.limit)));
  return selectAll(database, RANK_SQL, rankRow, input.kind, limit).map((row) => ({ name: row.name, displayName: labelOf(input.kind, row.name, names), kept: row.kept, seen: row.seen, used: row.kept + row.seen }));
}

/** One effect's standing, for the notes read: null when the user has never used it. */
export function effectUsageOf(database: DatabaseSync, matchName: string): EffectUsageRank | null {
  const ranked = rankedUsage(database, { kind: "effect", limit: RANK_LIMIT.max }), index = ranked.findIndex((entry) => entry.name === matchName), entry = ranked[index];
  return entry ? { rank: index + 1, kept: entry.kept, seen: entry.seen, used: entry.used } : null;
}

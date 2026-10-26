// Records what the user kept and what snapshots showed, one bounded row per (plan, control, slot) or (control, place), and removes it again on undo or forget.
import type { DatabaseSync } from "node:sqlite";
import { object, string } from "@extynt/decode";
import { execute, selectOne } from "./graph-sql.js";
import type { KeptUsageRecord, SeenUsageRecord } from "./effect-notes-input.js";
import { valueText } from "./effect-notes-value.js";
import type { NoteValue } from "./effect-notes-types.js";

const USAGE_ROWS_PER_CONTROL = 64;
const PLAN_ROWS = 2048;

const planState = object({ state: string() });

function scalarOf(value: NoteValue): number | null {
  return typeof value === "number" ? value : null;
}

function bounded(database: DatabaseSync, input: { matchName: string; controlPath: string; source: "kept" | "seen" }): void {
  execute(database, `DELETE FROM effect_value_usage WHERE id IN (SELECT id FROM effect_value_usage WHERE match_name=? AND control_path=? AND source=? ORDER BY recorded_at DESC,id DESC LIMIT -1 OFFSET ${USAGE_ROWS_PER_CONTROL})`,
    input.matchName, input.controlPath, input.source);
}

/** Registers a plan as contributing usage. False when the plan was already undone: a late record cannot resurrect it. */
export function claimKeptPlan(database: DatabaseSync, planId: string, at: number): boolean {
  if (selectOne(database, "SELECT state FROM effect_value_usage_plans WHERE plan_id=?", planState, planId)?.state === "undone") return false;
  execute(database, "INSERT INTO effect_value_usage_plans VALUES(?,'kept',?) ON CONFLICT(plan_id) DO UPDATE SET updated_at=excluded.updated_at", planId, at);
  return true;
}

/** A value the user kept: recorded once per (plan, control, slot) after the plan's receipt verified. A plan already undone records nothing. */
export function recordKeptUsage(database: DatabaseSync, record: KeptUsageRecord): boolean {
  const at = record.at ?? Date.now();
  if (!claimKeptPlan(database, record.planId, at)) return false;
  execute(database, `INSERT INTO effect_value_usage(match_name,control_path,source,value_text,scalar,plan_id,slot,recorded_at) VALUES(?,?,'kept',?,?,?,?,?)
    ON CONFLICT(plan_id,match_name,control_path,slot) WHERE source='kept' DO UPDATE SET value_text=excluded.value_text,scalar=excluded.scalar,recorded_at=excluded.recorded_at`,
  record.matchName, record.controlPath, valueText(record.value), scalarOf(record.value), record.planId, record.slot, at);
  execute(database, `DELETE FROM effect_value_usage_plans WHERE plan_id IN (SELECT plan_id FROM effect_value_usage_plans ORDER BY updated_at DESC,plan_id LIMIT -1 OFFSET ${PLAN_ROWS})`);
  bounded(database, { matchName: record.matchName, controlPath: record.controlPath, source: "kept" });
  return true;
}

/** A value seen in an accepted project snapshot. `key` names where it was seen, so a re-read replaces its value instead of counting twice. */
export function recordSeenUsage(database: DatabaseSync, record: SeenUsageRecord): boolean {
  execute(database, `INSERT INTO effect_value_usage(match_name,control_path,source,value_text,scalar,plan_id,slot,recorded_at) VALUES(?,?,'seen',?,?,NULL,?,?)
    ON CONFLICT(match_name,control_path,slot) WHERE source='seen' DO UPDATE SET value_text=excluded.value_text,scalar=excluded.scalar,recorded_at=excluded.recorded_at`,
  record.matchName, record.controlPath, valueText(record.value), scalarOf(record.value), record.key, record.at ?? Date.now());
  bounded(database, { matchName: record.matchName, controlPath: record.controlPath, source: "seen" });
  return true;
}

/** Undo removes what the plan contributed, so only kept values remain, and tombstones the plan so a late record cannot resurrect it. */
export function unrecordPlanUsage(database: DatabaseSync, input: { planId: string; at?: number }): number {
  const removed = execute(database, "DELETE FROM effect_value_usage WHERE plan_id=?", input.planId) + execute(database, "DELETE FROM effect_usage_events WHERE plan_id=?", input.planId);
  execute(database, "INSERT INTO effect_value_usage_plans VALUES(?,'undone',?) ON CONFLICT(plan_id) DO UPDATE SET state='undone',updated_at=excluded.updated_at", input.planId, input.at ?? Date.now());
  return removed;
}

/** Forget: every usage row, every usage event (effect, font and preset rankings) and the plan-contribution index. */
export function forgetAllUsage(database: DatabaseSync): number {
  const removed = execute(database, "DELETE FROM effect_value_usage") + execute(database, "DELETE FROM effect_usage_events");
  execute(database, "DELETE FROM effect_value_usage_plans");
  return removed;
}

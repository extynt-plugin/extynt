// Usage statistics computed on read: what the user kept and what snapshots showed for each control of an effect.
import { literal, nullable, number, object, string } from "@extynt/decode";
import type { DatabaseSync } from "node:sqlite";
import { selectAll } from "./graph-sql.js";
import { parseValueText } from "./effect-notes-value.js";
import type { ControlUsage, NoteValue, UsageStats } from "./effect-notes-types.js";

const RECENT = 3;
const ROW_LIMIT = 20000;

const usageRow = object({ control_path: string(), source: literal("kept", "seen"), scalar: nullable(number()), value_text: nullable(string()) });

interface UsageValue { scalar: number | null; value: NoteValue | null }
interface UsageGroup { kept: UsageValue[]; seen: UsageValue[] }

function median(sorted: readonly number[]): number | null {
  const middle = Math.floor(sorted.length / 2), upper = sorted[middle], lower = sorted[middle - 1];
  if (upper === undefined) return null;
  return sorted.length % 2 === 1 || lower === undefined ? upper : (lower + upper) / 2;
}

function stats(rows: readonly UsageValue[]): UsageStats {
  const scalars = rows.flatMap((row) => (row.scalar === null ? [] : [row.scalar])).sort((a, b) => a - b);
  const recent = rows.slice(-RECENT).flatMap((row) => (row.value === null ? [] : [row.value]));
  return { count: scalars.length, vectorCount: rows.length - scalars.length, min: scalars[0] ?? null, max: scalars.at(-1) ?? null, median: median(scalars), recent };
}

function statsOrNull(rows: readonly UsageValue[]): UsageStats | null {
  return rows.length === 0 ? null : stats(rows);
}

/** Usage statistics computed on read from the bounded rows; they never count toward a note cap. */
export function readUsage(database: DatabaseSync, matchName: string, controlPath: string | null): ControlUsage[] {
  const rows = selectAll(database, `SELECT control_path,source,scalar,value_text FROM effect_value_usage WHERE match_name=?1 AND (?2 IS NULL OR control_path=?2) ORDER BY control_path,source,recorded_at,id LIMIT ${ROW_LIMIT}`, usageRow, matchName, controlPath);
  const groups = new Map<string, UsageGroup>();
  for (const row of rows) {
    const group = groups.get(row.control_path) ?? { kept: [], seen: [] };
    group[row.source].push({ scalar: row.scalar, value: parseValueText(row.value_text) });
    groups.set(row.control_path, group);
  }
  return [...groups].map(([path, group]) => ({ controlPath: path, kept: statsOrNull(group.kept), seen: statsOrNull(group.seen) }));
}

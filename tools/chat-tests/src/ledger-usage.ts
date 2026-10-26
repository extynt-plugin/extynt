/**
 * Per-role model usage for the benchmark ledger. The sidecar reports a turn's usage as a record and may carry a per-role
 * breakdown (`main`, `visual-scene`, `motion`, ...) and a call count; every member is read defensively, so a sidecar
 * without them still yields main-only totals and a call count derived from the step count.
 */
import { isWireArray, isWireObject } from "@extynt/fake-plugin";
import type { WireObject, WireValue } from "./wire-types.js";

/** What one role of a turn cost. */
export interface RoleUsage { calls: number | null; freshInputTokens: number; cachedInputTokens: number; outputTokens: number }
/** Where a call count came from. */
export type CallsBasis = "reported" | "steps" | "none";
interface TurnUsage { roles: Record<string, RoleUsage>; callsBasis: CallsBasis }

type Row = WireObject;
const ROLE_CONTAINERS = ["byRole", "roles", "perRole", "usageByRole"] as const;
const CALL_KEYS = ["calls", "modelCalls", "callCount"] as const;

const recordOf = (value: WireValue | undefined): Row | undefined => (isWireObject(value) ? value : undefined);
const numberOf = (value: WireValue | undefined): number => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;

function callsOf(row: Row | undefined, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = row?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function roleUsage(row: Row | undefined, calls: number | null): RoleUsage {
  const input = numberOf(row?.inputTokens), cached = Math.min(numberOf(row?.cachedInputTokens), input);
  return { calls, freshInputTokens: input - cached, cachedInputTokens: cached, outputTokens: numberOf(row?.outputTokens) };
}

function roleRows(container: WireValue | undefined): Array<[string, Row]> {
  if (isWireArray(container)) {
    return container.flatMap((entry): Array<[string, Row]> => { const row = recordOf(entry); const role = row?.role; return row && typeof role === "string" ? [[role, row]] : []; });
  }
  return Object.entries(recordOf(container) ?? {}).flatMap(([role, value]): Array<[string, Row]> => {
    const row = recordOf(value);
    return row ? [[role, row]] : [];
  });
}

function reportedRoles(sources: Array<Row | undefined>): Array<[string, Row]> {
  for (const source of sources) for (const key of ROLE_CONTAINERS) {
    const rows = roleRows(source?.[key]);
    if (rows.length) return rows;
  }
  return [];
}

function totalsOf(usage: Row | undefined, turnRow: Row | undefined): Row {
  return usage ?? {
    inputTokens: turnRow?.inputTokens ?? null,
    outputTokens: turnRow?.outputTokens ?? null,
    cachedInputTokens: turnRow?.cachedInputTokens ?? null,
  };
}

function basisOf(reported: number | null, calls: number | null): CallsBasis {
  if (reported !== null) return "reported";
  return calls !== null ? "steps" : "none";
}

function derivedUsage(usage: Row | undefined, turnRow: Row | undefined, steps: number | undefined): TurnUsage {
  const reported = callsOf(usage, CALL_KEYS) ?? callsOf(turnRow, CALL_KEYS);
  const calls = reported ?? steps ?? null;
  return { roles: { main: roleUsage(totalsOf(usage, turnRow), calls) }, callsBasis: basisOf(reported, calls) };
}

/** What one turn cost, by role. `usage` is the report's usage record, `turnRow` the sidecar's last `agent.turn` log row. */
export function turnUsage(input: { usage: Row | undefined; turnRow: Row | undefined; steps: number | undefined }): TurnUsage {
  const rows = reportedRoles([input.usage, input.turnRow]);
  if (!rows.length) return derivedUsage(input.usage, input.turnRow, input.steps);
  return { roles: Object.fromEntries(rows.map(([role, row]) => [role, roleUsage(row, callsOf(row, [...CALL_KEYS, "steps"]))])), callsBasis: "reported" };
}

const addCalls = (a: number | null, b: number | null): number | null => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));

/** Adds role usage maps role by role. */
export function sumRoles(parts: ReadonlyArray<Record<string, RoleUsage>>): Record<string, RoleUsage> {
  const total: Record<string, RoleUsage> = {};
  for (const part of parts)
    for (const [role, usage] of Object.entries(part)) {
      const seen = total[role];
      total[role] = seen
        ? {
            calls: addCalls(seen.calls, usage.calls),
            freshInputTokens: seen.freshInputTokens + usage.freshInputTokens,
            cachedInputTokens: seen.cachedInputTokens + usage.cachedInputTokens,
            outputTokens: seen.outputTokens + usage.outputTokens,
          }
        : usage;
    }
  return total;
}

/** The total call count across roles, or null when none reported one. */
export function totalCalls(roles: Record<string, RoleUsage>): number | null {
  return Object.values(roles).reduce<number | null>((sum, usage) => addCalls(sum, usage.calls), null);
}

function sumMember(before: WireValue | undefined, value: WireValue): WireValue {
  if (typeof before === "number" && typeof value === "number") return before + value;
  const [left, right] = [recordOf(before), recordOf(value)];
  return left && right ? sumUsageRecords(left, right) ?? value : value;
}

/** Adds two usage records member by member, descending into nested records such as a per-role breakdown. */
export function sumUsageRecords(a: Row | undefined, b: Row | undefined): Row | undefined {
  if (!a || !b) return a ?? b;
  const sum: Record<string, WireValue> = { ...a };
  for (const [key, value] of Object.entries(b)) sum[key] = sumMember(sum[key], value);
  return sum;
}

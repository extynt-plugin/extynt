/** The warm and cold benchmark tables and their script line. */
import type { Derived, OpFailure, OpResult, OpSuccess } from "./bench.ts";
import { isFailure, isSuccess } from "./bench.ts";
import { fmtBytes, fmtInt, fmtMs, formatTable } from "./format.ts";

const WARM_HEADER = ["op", "runs", "rtt p50", "rtt p95", "main p50", "main p95", "queued p50", "walk p50", "hash p50", "ser p50", "bytes", "getters", "script us", "floor us"];
const COLD_HEADER = ["op", "rtt", "main", "queued", "walk", "hash", "ser", "bytes"];

function failureRow(entry: OpFailure): ReadonlyArray<string> {
  return [entry.name, "-", `ERROR ${entry.error.code}`, ...Array.from({ length: WARM_HEADER.length - 3 }, () => "")];
}

function successRow(entry: OpSuccess): ReadonlyArray<string> {
  const { warm } = entry;
  return [
    entry.name, String(entry.runs),
    fmtMs(warm.rttMs.p50), fmtMs(warm.rttMs.p95),
    fmtMs(warm.totalMainThreadMs.p50), fmtMs(warm.totalMainThreadMs.p95),
    fmtMs(warm.queuedMs.p50), fmtMs(warm.walkMs.p50), fmtMs(warm.hashMs.p50), fmtMs(warm.serializeMs.p50),
    fmtBytes(warm.bytes.p50), fmtInt(warm.getterCalls.p50),
    warm.revisionUs ? fmtMs(warm.revisionUs.p50) : "", warm.floorUs ? fmtMs(warm.floorUs.p50) : "",
  ];
}

function warmRow(entry: OpResult): ReadonlyArray<string> {
  return isFailure(entry) ? failureRow(entry) : successRow(entry);
}

function coldRow(entry: OpSuccess): ReadonlyArray<string> {
  const { cold } = entry;
  const timing = cold.timing;
  return [
    entry.name,
    fmtMs(cold.rttMs),
    fmtMs(timing.totalMainThreadMs),
    fmtMs(timing.queuedMs),
    fmtMs(timing.walkMs),
    fmtMs(timing.hashMs),
    fmtMs(timing.serializeMs),
    fmtBytes(timing.bytes),
  ];
}

/** The warm statistics, one row per op. */
export function warmTable(ops: ReadonlyArray<OpResult>): string {
  return formatTable(WARM_HEADER, ops.map(warmRow));
}

/** The first sample of every op that answered, one row per op. */
export function coldTable(ops: ReadonlyArray<OpResult>): string {
  return formatTable(COLD_HEADER, ops.filter(isSuccess).map(coldRow));
}

/** The AEGP_ExecuteScript cost line: app.project.revision against the floor script `1`. */
export function executeScriptLine(derived: Derived): string {
  const script = derived.executeScript;
  return `ExecuteScript: app.project.revision p50 ${fmtMs(script.revisionUsP50)} us, floor (script \`1\`) p50 ${fmtMs(script.floorUsP50)} us, delta ${fmtMs(script.deltaUs)} us`;
}

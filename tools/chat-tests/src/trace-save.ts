/** Saves the trace of every scenario of a run as JSONL, so a run leaves data behind: timings, tool calls, answers. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringMember } from "./wire-reads.js";
import { REPO_ROOT } from "./repo-root.js";
import type { ScenarioRun, TurnRecord } from "./run-types.js";
import { createTrace, recordsToJsonl, type Trace, type TraceRecord } from "./trace.js";
import { orNull, type TurnEndBody } from "./trace-records.js";
import type { WireObject } from "./wire-types.js";

/** Where traces go unless the caller names a directory; git ignores it. */
export const DEFAULT_TRACE_DIRECTORY = join(REPO_ROOT, "tools", "chat-tests", "traces");

function requestIdOf(run: ScenarioRun, turn: TurnRecord): string {
  return turn.index === 1 ? `chat-test-${run.scenario.id}` : `chat-test-${run.scenario.id}-t${turn.index}`;
}

function providerOf(name: string | undefined): WireObject | undefined {
  return name === undefined ? undefined : { displayName: name };
}

function turnEnd(turn: TurnRecord): TurnEndBody | undefined {
  const report = turn.report;
  if (!report) return undefined;
  return {
    kind: "turn.end",
    status: report.status,
    outcome: orNull(report.outcome),
    steps: orNull(report.steps),
    stopReason: orNull(report.stopReason),
    usage: orNull(report.usage),
    provider: orNull(providerOf(report.provider)),
    model: orNull(report.model),
    plans: report.plans.map((plan) => ({ planId: plan.planId, title: plan.title })),
    notes: report.notes,
    failure: orNull(report.failure),
    answer: report.answer,
  };
}

function recordTurn(trace: Trace, run: ScenarioRun, turn: TurnRecord): void {
  trace.record({ kind: "turn.start", message: turn.message, requestId: requestIdOf(run, turn) });
  for (const line of turn.logLines) trace.record({ kind: "sidecar.log", line }, stringMember(line, "at"));
  const end = turnEnd(turn);
  if (end) trace.record(end);
}

/**
 * The records of a run that had no provider wrapper: each turn's request, the sidecar's own log
 * lines for it, and how it ended. A spawned sidecar cannot hand over the provider traffic.
 */
export function recordsFromRun(run: ScenarioRun): TraceRecord[] {
  const trace = createTrace();
  for (const turn of run.turns ?? []) recordTurn(trace, run, turn);
  return trace.records;
}

interface TraceSaveRequest {
  directory: string;
  runId: string;
  runs: readonly ScenarioRun[];
  traced: ReadonlyMap<string, readonly TraceRecord[]>;
}

/** Writes `<directory>/<runId>/<scenario>.jsonl` for every scenario that ran, and returns the paths. */
export function saveRunTraces(request: TraceSaveRequest): string[] {
  const folder = join(request.directory, request.runId);
  const written: string[] = [];
  for (const run of request.runs) {
    if (run.skipped) continue;
    const records = request.traced.get(run.scenario.id) ?? recordsFromRun(run);
    if (!records.length) continue;
    mkdirSync(folder, { recursive: true });
    const path = join(folder, `${run.scenario.id}.jsonl`);
    writeFileSync(path, recordsToJsonl(records));
    written.push(path);
  }
  return written;
}

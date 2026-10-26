/** Privacy-bounded, append-only benchmark records. A row is one scenario run, never one transcript line. */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";

import { isWireArray } from "@extynt/fake-plugin";
import { decodeLedgerLine } from "./ledger-decode.js";
import { sumRoles, totalCalls, turnUsage, type CallsBasis, type RoleUsage } from "./ledger-usage.js";
import { MUTATING_TOOLS } from "./run-expect.js";
import type { LogLine, ScenarioRun, TurnRecord } from "./run-types.js";
import type { TraceRecord } from "./trace.js";
import { numberMember, stringMember } from "./wire-reads.js";

export const BENCHMARK_LEDGER_SCHEMA = "0.2" as const;
export type EvidenceMode = "planning-only" | "headless-apply" | "headless-fixture-readback" | "live-host-structural" | "live-host-temporal-visual";

export interface BenchmarkLedgerRow {
  schemaVersion: typeof BENCHMARK_LEDGER_SCHEMA;
  runId: string;
  recordedAt: string;
  revision: { git: string | null; dirty: boolean | null };
  scenario: { id: string; asset: string };
  runtime: { provider: string | null; model: string | null; evidenceMode: EvidenceMode };
  result: { outcome: string | null; expectationPassed: boolean; cutoff: "harness" | "provider" | "transport" | null; failureCodes: string[] };
  work: {
    steps: number;
    workflowCycles: number | null;
    stageSelections: number;
    stageReselections: number;
    queuedOperations: number;
    batchCount: number;
    batchUtilization: number | null;
  };
  refusals: { total: number; firstAttemptAdmitted: boolean | null; byToolAndCode: Record<string, number>; byOperationAndCode: Record<string, number> };
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; cachedInputTokens: number; freshInputTokens: number };
  modelCalls: { total: number | null; byRole: Record<string, number | null>; basis: CallsBasis };
  usageByRole: Record<string, RoleUsage>;
  turns: LedgerTurn[];
  folding: { count: number; removedCharacters: number };
  target: { expectedLayerId: string | null; matched: boolean | null };
  receipt: { state: "not-applied" | "applied-unverified" | "verified" | "partial-or-failed"; appliedOperations: number; failedOperations: number; basis: "none" | "headless-fixture" | "live-host" };
  timing: { totalMs: number | null; authoringMs: number | null; hostSettleMs: number | null };
}

export interface LedgerTurn { index: number; passed: boolean; cutoff: "harness" | "provider" | "transport" | null; wallMs: number | null; callsBasis: CallsBasis; modelCalls: number | null; usageByRole: Record<string, RoleUsage> }

export interface LedgerContext { runId: string; recordedAt?: string; evidenceMode: EvidenceMode; traceRecords?: readonly TraceRecord[] | undefined }

const numberOf = (value: number | undefined): number => (value !== undefined && Number.isFinite(value) ? value : 0);
const lastEvent = (lines: readonly LogLine[], event: string): LogLine | undefined => [...lines].reverse().find((line) => stringMember(line, "event") === event);

function gitValue(args: string[]): string | null {
  try { return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null; }
  catch { return null; }
}

export function repositoryRevision(): BenchmarkLedgerRow["revision"] {
  const git = gitValue(["rev-parse", "HEAD"]);
  if (!git) return { git: null, dirty: null };
  return { git, dirty: Boolean(gitValue(["status", "--porcelain"])) };
}

function usage(run: ScenarioRun): BenchmarkLedgerRow["usage"] {
  const value = run.report?.usage ?? {};
  const inputTokens = numberOf(numberMember(value, "inputTokens"));
  const outputTokens = numberOf(numberMember(value, "outputTokens"));
  const cachedInputTokens = Math.min(numberOf(numberMember(value, "cachedInputTokens")), inputTokens);
  return { inputTokens, outputTokens, totalTokens: numberOf(numberMember(value, "totalTokens")) || inputTokens + outputTokens, cachedInputTokens, freshInputTokens: inputTokens - cachedInputTokens };
}

function turnsOf(run: ScenarioRun): TurnRecord[] {
  if (run.turns?.length) return run.turns;
  const passed = !run.skipped && run.failures.length === 0;
  return [{ index: 1, message: run.scenario.message, report: run.report, logLines: run.logLines, factFailures: [], passed }];
}

function ledgerTurns(run: ScenarioRun): LedgerTurn[] {
  return turnsOf(run).map((turn) => {
    const turnRow = lastEvent(turn.logLines, "agent.turn");
    const { roles, callsBasis } = turnUsage({ usage: turn.report?.usage, turnRow, steps: turn.report?.steps });
    return {
      index: turn.index,
      passed: turn.passed,
      cutoff: turn.report?.cutOff ?? null,
      wallMs: turn.report?.durationMs ?? null,
      callsBasis,
      modelCalls: totalCalls(roles),
      usageByRole: roles,
    };
  });
}

function modelUsage(turns: readonly LedgerTurn[]): Pick<BenchmarkLedgerRow, "modelCalls" | "usageByRole"> {
  const usageByRole = sumRoles(turns.map((turn) => turn.usageByRole));
  const basis: CallsBasis = turns.some((turn) => turn.callsBasis === "reported")
    ? "reported"
    : turns.some((turn) => turn.callsBasis === "steps")
      ? "steps"
      : "none";
  return {
    modelCalls: { total: totalCalls(usageByRole), byRole: Object.fromEntries(Object.entries(usageByRole).map(([role, value]) => [role, value.calls])), basis },
    usageByRole,
  };
}

function foldMetrics(records: readonly TraceRecord[]): BenchmarkLedgerRow["folding"] {
  let count = 0, removedCharacters = 0;
  for (const record of records) {
    if (record.kind !== "context.fold") continue;
    count += 1;
    for (const entry of record.messages) removedCharacters += Math.max(0, entry.beforeChars - entry.afterChars);
  }
  return { count, removedCharacters };
}

function boundedCode(value: string | undefined): string {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : "UNKNOWN";
}

function incrementMetric(metrics: Record<string, number>, key: string): void {
  metrics[key] = (metrics[key] ?? 0) + 1;
}

function recordAdmissionRefusal(event: LogLine, byToolAndCode: Record<string, number>, byOperationAndCode: Record<string, number>): void {
  const tool = stringMember(event, "tool") ?? "unknown";
  const code = boundedCode(stringMember(event, "errorCode"));
  incrementMetric(byToolAndCode, `${tool}:${code}`);
  const types = event.operationTypes;
  const operationTypes = isWireArray(types) ? types : [];
  for (const value of operationTypes) {
    const operation = typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : "unknown";
    incrementMetric(byOperationAndCode, `${operation}:${code}`);
  }
}

function refusalMetrics(run: ScenarioRun): BenchmarkLedgerRow["refusals"] {
  const byToolAndCode: Record<string, number> = {};
  const byOperationAndCode: Record<string, number> = {};
  const admissionEvents = run.logLines.filter((line) => stringMember(line, "event") === "agent.admission_rejected");
  for (const event of admissionEvents) recordAdmissionRefusal(event, byToolAndCode, byOperationAndCode);
  for (const batch of run.fakeHostBatches ?? []) for (const refusal of batch.refused) {
    const operation = /^[a-z][a-z0-9_]{0,63}$/.test(refusal.type) ? refusal.type : "unknown";
    incrementMetric(byOperationAndCode, `${operation}:${boundedCode(refusal.code)}`);
  }
  const total = admissionEvents.length + (run.fakeHostBatches ?? []).reduce((sum, batch) => sum + batch.refused.length, 0);
  const authoringAttempted = run.logLines.some((line) => stringMember(line, "event") === "agent.tool" && MUTATING_TOOLS.includes(String(line.tool)));
  return { total, firstAttemptAdmitted: authoringAttempted ? admissionEvents.length === 0 : null, byToolAndCode, byOperationAndCode };
}

function result(run: ScenarioRun): BenchmarkLedgerRow["result"] {
  const failureCodes = (run.report?.tools ?? []).filter((tool) => !tool.ok).map((tool) => boundedCode(tool.code));
  return {
    outcome: run.report?.outcome ?? null,
    expectationPassed: !run.skipped && run.failures.length === 0,
    cutoff: run.report?.cutOff ?? null,
    failureCodes: [...new Set(failureCodes)],
  };
}

function target(run: ScenarioRun): BenchmarkLedgerRow["target"] {
  const expectedLayerId = run.scenario.expect.targetsLayer ?? null;
  if (!expectedLayerId) return { expectedLayerId, matched: null };
  return { expectedLayerId, matched: Boolean(run.report) && !run.failures.some((failure) => failure.startsWith("nothing targeted ")) };
}

function receipt(run: ScenarioRun, evidenceMode: EvidenceMode): BenchmarkLedgerRow["receipt"] {
  if (evidenceMode === "live-host-structural") return { state: run.report?.plans.length ? "applied-unverified" : "not-applied", appliedOperations: 0, failedOperations: 0, basis: "live-host" };
  const batches = run.fakeHostBatches ?? [];
  const appliedOperations = batches.reduce((sum, batch) => sum + batch.applied, 0);
  const failedOperations = batches.reduce((sum, batch) => sum + batch.refused.length, 0);
  if (!batches.length) return { state: "not-applied", appliedOperations: 0, failedOperations: 0, basis: "none" };
  if (failedOperations) return { state: "partial-or-failed", appliedOperations, failedOperations, basis: "headless-fixture" };
  return { state: evidenceMode === "headless-fixture-readback" ? "verified" : "applied-unverified", appliedOperations, failedOperations, basis: "headless-fixture" };
}

function work(run: ScenarioRun): BenchmarkLedgerRow["work"] {
  const stageSelections = run.logLines.filter((line) => stringMember(line, "event") === "agent.tool" && stringMember(line, "tool") === "ae_select_workflow_stage").length;
  const queuedOperations = (run.fakeHostBatches ?? []).reduce((sum, batch) => sum + batch.operations, 0);
  const batchCount = run.fakeHostBatches?.length ?? 0;
  return {
    steps: run.report?.steps ?? 0,
    workflowCycles: null,
    stageSelections,
    stageReselections: Math.max(0, stageSelections - batchCount),
    queuedOperations,
    batchCount,
    batchUtilization: batchCount ? queuedOperations / (batchCount * 25) : null,
  };
}

function timing(run: ScenarioRun): BenchmarkLedgerRow["timing"] {
  const turn = lastEvent(run.logLines, "agent.turn");
  return { totalMs: run.report?.durationMs ?? null, authoringMs: (turn && numberMember(turn, "authoringMs")) ?? null, hostSettleMs: (turn && numberMember(turn, "hostSettleMs")) ?? null };
}

export function ledgerRow(run: ScenarioRun, context: LedgerContext, revision = repositoryRevision()): BenchmarkLedgerRow {
  const turns = ledgerTurns(run);
  return {
    schemaVersion: BENCHMARK_LEDGER_SCHEMA,
    runId: context.runId,
    recordedAt: context.recordedAt ?? new Date().toISOString(),
    revision,
    scenario: { id: run.scenario.id, asset: run.scenario.asset },
    runtime: { provider: run.report?.provider ?? null, model: run.report?.model ?? null, evidenceMode: context.evidenceMode },
    result: result(run),
    work: work(run),
    refusals: refusalMetrics(run),
    usage: usage(run),
    ...modelUsage(turns),
    turns,
    folding: foldMetrics(context.traceRecords ?? []),
    target: target(run),
    receipt: receipt(run, context.evidenceMode),
    timing: timing(run),
  };
}

export function appendLedger(path: string, rows: readonly BenchmarkLedgerRow[]): void {
  if (!rows.length) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", { encoding: "utf8", flag: "a" });
}

export function readLedger(path: string): BenchmarkLedgerRow[] {
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((line, index) => decodeLedgerLine(line, `${path}:${index + 1}`));
}

const seconds = (ms: number | null): string => (ms === null ? "n/a" : `${(ms / 1000).toFixed(1)}s`);
const callText = (calls: number | null): string => (calls === null ? "?" : String(calls));

function roleText(roles: Record<string, RoleUsage>): string {
  return Object.entries(roles).map(([role, usage]) => `${role}: ${callText(usage.calls)} call(s), fresh ${usage.freshInputTokens} / cached ${usage.cachedInputTokens} / out ${usage.outputTokens}`).join("; ");
}

function turnLines(row: BenchmarkLedgerRow): string[] {
  if (row.turns.length < 2) return [];
  return row.turns.map((turn) => `    turn ${turn.index}: ${turn.passed ? "pass" : "FAIL"}${turn.cutoff ? ` (cut off: ${turn.cutoff})` : ""}, ${callText(turn.modelCalls)} call(s), ${seconds(turn.wallMs)}, ${roleText(turn.usageByRole)}`);
}

function rowLines(row: BenchmarkLedgerRow): string[] {
  const head = `  ${row.scenario.id}: ${row.result.expectationPassed ? "pass" : "FAIL"}, ${callText(row.modelCalls.total)} call(s) [${row.modelCalls.basis}], ${seconds(row.timing.totalMs)}, fresh ${row.usage.freshInputTokens} / cached ${row.usage.cachedInputTokens} / out ${row.usage.outputTokens}`;
  return [head, `    ${roleText(row.usageByRole)}`, ...turnLines(row)];
}

export function ledgerSummary(rows: readonly BenchmarkLedgerRow[]): string {
  const passed = rows.filter((row) => row.result.expectationPassed).length;
  const targetRows = rows.filter((row) => row.target.matched !== null);
  const targets = targetRows.filter((row) => row.target.matched).length;
  const tokens = rows.reduce((sum, row) => sum + row.usage.totalTokens, 0);
  const refusals = rows.reduce((sum, row) => sum + row.refusals.total, 0);
  const cutoffs = rows.filter((row) => row.result.cutoff).length;
  const total = `${rows.length} row(s); ${passed} expectation pass; ${targets}/${targetRows.length} exact targets; ${refusals} refusal(s); ${cutoffs} cutoff(s); ${tokens} tokens`;
  return [total, ...rows.flatMap(rowLines)].join("\n");
}

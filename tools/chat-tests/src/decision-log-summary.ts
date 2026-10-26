// Summarises the sidecar decision log: calls per job, calls and questions per moment, and median and p95 latency per moment, from its JSON lines alone.
import { decodeJson, literal, nullable, number, object, string, type Decoder } from "@extynt/decode";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DECISION_MOMENTS = ["job-open", "build-kit", "completion", "review", "frame-gate", "cycle-end", "continuation", "question-answered"] as const;

interface LoggedRow {
  readonly at: string;
  readonly decision: string;
  readonly moment: (typeof DECISION_MOMENTS)[number];
  readonly jobId: string | null;
  readonly questions: number;
  readonly latencyMs: number;
}

interface MomentSummary {
  readonly moment: LoggedRow["moment"];
  readonly calls: number;
  readonly questions: number;
  readonly medianMs: number;
  readonly p95Ms: number;
}

interface JobSummary {
  readonly jobId: string;
  readonly calls: number;
  readonly questions: number;
}

interface DecisionLogSummary {
  readonly rows: number;
  readonly calls: number;
  readonly skipped: number;
  readonly moments: ReadonlyArray<MomentSummary>;
  readonly jobs: ReadonlyArray<JobSummary>;
}

interface Call {
  readonly moment: LoggedRow["moment"];
  readonly jobId: string | null;
  readonly questions: number;
  readonly latencyMs: number;
}

const LOGGED_ROW: Decoder<LoggedRow> = object({
  at: string(),
  decision: string(),
  moment: literal(...DECISION_MOMENTS),
  jobId: nullable(string()),
  questions: number(),
  latencyMs: number(),
});

function p95Of(sorted: ReadonlyArray<number>): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.ceil(0.95 * sorted.length) - 1] ?? 0;
}

function medianOf(sorted: ReadonlyArray<number>): number {
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function callsOf(rows: ReadonlyArray<LoggedRow>): Call[] {
  const byCall = new Map<string, LoggedRow>();
  for (const row of rows) byCall.set(`${row.at}\u0000${row.moment}\u0000${row.jobId ?? ""}`, row);
  return [...byCall.values()];
}

function momentsOf(calls: ReadonlyArray<Call>): MomentSummary[] {
  return DECISION_MOMENTS.flatMap((moment) => {
    const own = calls.filter((call) => call.moment === moment);
    if (own.length === 0) return [];
    const latencies = own.map((call) => call.latencyMs).sort((left, right) => left - right);
    const questions = own.reduce((sum, call) => sum + call.questions, 0);
    return [{ moment, calls: own.length, questions, medianMs: medianOf(latencies), p95Ms: p95Of(latencies) }];
  });
}

function jobsOf(calls: ReadonlyArray<Call>): JobSummary[] {
  const jobs = new Map<string, { calls: number; questions: number }>();
  for (const call of calls) {
    const key = call.jobId ?? "none";
    const entry = jobs.get(key) ?? { calls: 0, questions: 0 };
    jobs.set(key, { calls: entry.calls + 1, questions: entry.questions + call.questions });
  }
  return [...jobs].map(([jobId, entry]) => ({ jobId, ...entry }));
}

/** Summarises the log's JSON lines: lines that do not decode are counted as skipped and left out of the tables. */
export function summarizeDecisionLog(text: string): DecisionLogSummary {
  const decoded = text.split("\n").filter((line) => line.trim() !== "").map((line) => decodeJson(line, LOGGED_ROW));
  const rows = decoded.flatMap((result) => (result.ok ? [result.value] : []));
  const calls = callsOf(rows);
  return { rows: rows.length, calls: calls.length, skipped: decoded.length - rows.length, moments: momentsOf(calls), jobs: jobsOf(calls) };
}

/** The summary as plain text: one table per moment and one per job. */
export function formatDecisionLogSummary(summary: DecisionLogSummary): string {
  const momentLines = summary.moments.map((moment) => `  ${moment.moment.padEnd(18)} calls ${String(moment.calls).padStart(4)}  questions ${String(moment.questions).padStart(4)}  median ${moment.medianMs} ms  p95 ${moment.p95Ms} ms`);
  const jobLines = summary.jobs.map((job) => `  ${job.jobId.padEnd(24)} calls ${String(job.calls).padStart(4)}  questions ${String(job.questions).padStart(4)}`);
  return [`rows ${summary.rows}; calls ${summary.calls}; skipped ${summary.skipped}`, "calls per moment:", ...momentLines, "calls per job:", ...jobLines, ""].join("\n");
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (path === undefined) throw new Error("usage: decision-log-summary.ts <decision-log.jsonl>");
  process.stdout.write(formatDecisionLogSummary(summarizeDecisionLog(readFileSync(path, "utf8"))));
}

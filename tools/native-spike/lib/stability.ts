/** The stability pass: repeated requests, slow requests and silences. */
import { appendFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { chooseTarget } from "./bench-target.ts";
import type { BenchTarget } from "./bench-target.ts";
import type { NativeClient } from "./client.ts";
import { connectNative } from "./connect.ts";
import { SpikeError, systemCode } from "./errors.ts";
import { summarize } from "./stats.ts";
import type { Summary } from "./stats.ts";
import type { NativeResponse } from "./wire.ts";

const OPTIONS = {
  n: { type: "string" }, "interval-ms": { type: "string" }, "slow-ms": { type: "string" }, "comp-name": { type: "string" },
  "layer-name": { type: "string" }, log: { type: "string" },
  "timeout-ms": { type: "string" }, discovery: { type: "string" }, "no-pid-check": { type: "boolean" }, help: { type: "boolean", short: "h" },
} as const;

/** The usage text of the stability script. */
export const STABILITY_USAGE = `stability: a supervised stream of read_paths requests with a wall-clock log, for the UI stability pass.

usage: node tools/native-spike/stability.ts [--n 300] [--interval-ms 100]
         [--comp-name NAME] [--layer-name NAME] [--slow-ms 250] [--timeout-ms 60000] [--log FILE] [--discovery FILE]

Sends one read_paths every --interval-ms, logs every request (epoch ms, ISO time, rtt, dispatchedBy, queued) as one JSON
line to --log as it happens, and prints a summary. Stops at the first error or timeout.
`;

/** What a stability run needs: how many requests, how often, what counts as slow, and where to connect and log. */
export interface StabilityRunOptions {
  readonly n: number;
  readonly intervalMs: number;
  readonly slowMs: number;
  readonly timeoutMs: number;
  readonly discovery: string | undefined;
  readonly skipPidCheck: boolean;
  readonly log?: string | undefined;
  readonly compName?: string | undefined;
  readonly layerName?: string | undefined;
}

/** The parsed command line of the stability script. */
export interface StabilityOptions extends StabilityRunOptions {
  readonly help: boolean;
}

/** When a request was sent: its index, the epoch milliseconds and the ISO time. */
export interface Stamp {
  readonly i: number;
  readonly epochMs: number;
  readonly at: string;
}

/** A request the plugin answered ok. */
export interface AnsweredRecord extends Stamp {
  readonly ok: true;
  readonly rttMs: number;
  readonly dispatchedBy: string;
  readonly queuedMs?: number | undefined;
}

/** A request that failed or was answered with an error. */
export interface FailedRecord extends Stamp {
  readonly ok: false;
  readonly error: string;
}

/** One logged request. */
export type StabilityRecord = AnsweredRecord | FailedRecord;

/** A request slower than the threshold. */
export interface SlowRequest {
  readonly i: number;
  readonly at: string;
  readonly rttMs: number;
  readonly dispatchedBy: string;
}

/** Counts, latency stats, dispatch paths, the slow requests and the longest silence between answers. */
export interface StabilitySummary {
  readonly requests: number;
  readonly answered: number;
  readonly errors: ReadonlyArray<FailedRecord>;
  readonly rtt: Summary;
  readonly byPath: Readonly<Record<string, number>>;
  readonly slow: ReadonlyArray<SlowRequest>;
  readonly longestGapMs: number;
}

type WholeOption = "n" | "interval-ms" | "slow-ms" | "timeout-ms";

function readValues(argv: ReadonlyArray<string>) {
  return parseArgs({ args: [...argv], options: OPTIONS, strict: true });
}

type ParsedValues = ReturnType<typeof readValues>["values"];

function whole(values: ParsedValues, name: WholeOption, fallback: number, min: number): number {
  const raw = values[name];
  if (raw === undefined) return fallback;
  const number = Number(raw);
  if (!Number.isInteger(number) || number < min) throw new SpikeError("USAGE", `--${name} must be an integer of at least ${min}, got "${raw}".`);
  return number;
}

/** Parses the stability script's arguments; any problem is a USAGE SpikeError. */
export function parseStabilityArgs(argv: ReadonlyArray<string>): StabilityOptions {
  let parsed: ReturnType<typeof readValues>;
  try { parsed = readValues(argv); } catch (error) {
    throw new SpikeError("USAGE", `${error instanceof Error ? error.message : String(error)}. Run with --help.`);
  }
  const v = parsed.values;
  return {
    help: v.help === true, n: whole(v, "n", 300, 1), intervalMs: whole(v, "interval-ms", 100, 0), slowMs: whole(v, "slow-ms", 250, 1),
    timeoutMs: whole(v, "timeout-ms", 60000, 1), compName: v["comp-name"], layerName: v["layer-name"],
    log: v.log, discovery: v.discovery, skipPidCheck: v["no-pid-check"] === true,
  };
}

function isAnswered(entry: StabilityRecord): entry is AnsweredRecord {
  return entry.ok;
}

function isFailed(entry: StabilityRecord): entry is FailedRecord {
  return !entry.ok;
}

function countByPath(answered: ReadonlyArray<AnsweredRecord>): Readonly<Record<string, number>> {
  const byPath: Record<string, number> = {};
  for (const entry of answered) byPath[entry.dispatchedBy] = (byPath[entry.dispatchedBy] ?? 0) + 1;
  return byPath;
}

function longestGap(answered: ReadonlyArray<AnsweredRecord>): number {
  let longest = 0;
  let previous: AnsweredRecord | undefined;
  for (const entry of answered) {
    if (previous) longest = Math.max(longest, entry.epochMs - previous.epochMs);
    previous = entry;
  }
  return longest;
}

/** Pure: counts, latency stats, dispatch paths, the slow requests and the longest silence between answers. */
export function summarizeStability(records: ReadonlyArray<StabilityRecord>, slowMs: number): StabilitySummary {
  const answered = records.filter(isAnswered);
  const slow = answered
    .filter((entry) => entry.rttMs >= slowMs)
    .map((entry) => ({ i: entry.i, at: entry.at, rttMs: entry.rttMs, dispatchedBy: entry.dispatchedBy }));
  return {
    requests: records.length,
    answered: answered.length,
    errors: records.filter(isFailed),
    rtt: summarize(answered.map((entry) => entry.rttMs)),
    byPath: countByPath(answered),
    slow,
    longestGapMs: longestGap(answered),
  };
}

/** The human report of a stability run. */
export function formatStability(summary: StabilitySummary, slowMs: number): string {
  const rtt = summary.rtt;
  const lines = [`requests ${summary.requests}, answered ${summary.answered}, errors ${summary.errors.length}`];
  lines.push(`rtt ms: p50 ${rtt.p50?.toFixed(2)}  p95 ${rtt.p95?.toFixed(2)}  max ${rtt.max?.toFixed(2)}`);
  lines.push(`dispatchedBy: ${Object.entries(summary.byPath).map(([name, count]) => `${name}=${count}`).join(" ") || "-"}`);
  lines.push(`longest gap between answers: ${summary.longestGapMs} ms`, `slow requests (rtt >= ${slowMs} ms): ${summary.slow.length}`);
  for (const entry of summary.slow.slice(0, 40)) lines.push(`  #${entry.i} ${entry.at} rtt ${entry.rttMs.toFixed(1)} ms via ${entry.dispatchedBy}`);
  for (const entry of summary.errors) lines.push(`ERROR #${entry.i} ${entry.at}: ${entry.error}`);
  return lines.join("\n");
}

function outcomeOf(response: NativeResponse, rttMs: number): Omit<AnsweredRecord, keyof Stamp> | Omit<FailedRecord, keyof Stamp> {
  if (!response.ok) return { ok: false, error: `${response.error?.code}: ${response.error?.message}` };
  const timing = response.timing ?? {};
  return { ok: true, rttMs, dispatchedBy: timing.dispatchedBy ?? "?", queuedMs: timing.queuedMs };
}

type RecordSink = (entry: StabilityRecord) => StabilityRecord;

async function sendOnce(client: NativeClient, index: number, target: BenchTarget, record: RecordSink): Promise<StabilityRecord> {
  const startedAt = Date.now();
  const stamp = { i: index, epochMs: startedAt, at: new Date(startedAt).toISOString() };
  try {
    const params = { targets: [{ compId: target.compId, layerId: target.layerId, path: target.path }] };
    const { response, rttMs } = await client.request("read_paths", params);
    return record({ ...stamp, ...outcomeOf(response, rttMs) });
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    return record({ ...stamp, ok: false, error: `${systemCode(failure) ?? "ERROR"}: ${failure.message}` });
  }
}

const pause = (ms: number): Promise<void> => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/** Sends read_paths requests at the configured interval, logging each, and summarises the run. Stops at the first error. */
export async function runStability(options: StabilityRunOptions): Promise<StabilitySummary> {
  const { client } = await connectNative(options);
  const records: StabilityRecord[] = [];
  const record = (entry: StabilityRecord): StabilityRecord => { records.push(entry); if (options.log) appendFileSync(options.log, `${JSON.stringify(entry)}\n`); return entry; };
  if (options.log) writeFileSync(options.log, "");
  try {
    const structure = await client.call("read_project", { detail: "structure" });
    const target = chooseTarget(structure.response.result, options);
    for (let index = 0; index < options.n; index += 1) {
      const entry = await sendOnce(client, index, target, record);
      if (!entry.ok) break;
      await pause(options.intervalMs);
    }
  } finally {
    client.close();
  }
  return summarizeStability(records, options.slowMs);
}

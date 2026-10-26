/** Times native operations and summarises the samples. */
import { isJsonObject } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";
import type { BenchTarget } from "./bench-target.ts";
import type { NativeClient } from "./client.ts";
import { numberAt } from "./json-access.ts";
import { summarize } from "./stats.ts";
import type { Summary } from "./stats.ts";
import type { NativeResponse, NativeTiming } from "./wire.ts";

/** The error body of a failed operation. */
export type OpError = NonNullable<NativeResponse["error"]>;

/** The in-script timings of the `revision` op, in microseconds. */
export interface ScriptFigures {
  readonly revisionUs: number | undefined;
  readonly floorUs: number | undefined;
}

/** One benchmarked operation: what to send and which extra figures to read from its result. */
export interface BenchOpSpec {
  readonly name: string;
  readonly op: string;
  readonly params: (target: BenchTarget) => JsonObject;
  readonly extras?: (result: JsonValue | undefined) => ScriptFigures;
}

/** One answered request: round trip, the plugin's timings and the extra figures. */
export interface Sample {
  readonly rttMs: number;
  readonly timing: NativeTiming;
  readonly extras: ScriptFigures | undefined;
}

/** The summaries of the plugin's timing figures over a list of samples. */
export interface TimingStats {
  readonly rttMs: Summary;
  readonly totalMainThreadMs: Summary;
  readonly queuedMs: Summary;
  readonly walkMs: Summary;
  readonly hashMs: Summary;
  readonly serializeMs: Summary;
  readonly bytes: Summary;
  readonly getterCalls: Summary;
}

/** The summaries of the warm samples; the script figures exist for the `revision` op only. */
export interface WarmStats extends TimingStats {
  readonly revisionUs?: Summary;
  readonly floorUs?: Summary;
}

/** An op that answered an error. */
export interface OpFailure {
  readonly name: string;
  readonly op: string;
  readonly error: OpError;
  readonly runs: number;
}

/** An op measured over all its runs. */
export interface OpSuccess {
  readonly name: string;
  readonly op: string;
  readonly runs: number;
  readonly cold: Sample;
  readonly warm: WarmStats;
  readonly dispatchedBy: ReadonlyArray<string>;
}

/** The outcome of benchmarking one op. */
export type OpResult = OpFailure | OpSuccess;

/** How many runs to time and where read_comp and read_paths aim. */
export interface BenchOptions {
  readonly runs: number;
  readonly target: BenchTarget;
}

/** Transport floor and idle-hook latency. */
export interface Latencies {
  readonly transportFloorMs: number | null;
  readonly idleHookLatencyMs: number | null;
}

/** What AEGP_ExecuteScript itself costs, in microseconds. */
export interface ExecuteScriptCost {
  readonly revisionUsP50: number | null;
  readonly floorUsP50: number | null;
  readonly deltaUs: number | null;
}

/** Every derived figure of a run. */
export interface Derived extends Latencies {
  readonly executeScript: ExecuteScriptCost;
  readonly dispatchedBy: string;
}

type Taken = { readonly sample: Sample } | { readonly error: OpError };

function scriptFigures(result: JsonValue | undefined): ScriptFigures {
  const row = isJsonObject(result) ? result : {};
  return { revisionUs: numberAt(row, "revisionUs"), floorUs: numberAt(row, "floorUs") };
}

/** The ops the benchmark times, in order. */
export const BENCH_OPS: ReadonlyArray<BenchOpSpec> = [
  { name: "ping_direct", op: "ping_direct", params: () => ({}) },
  { name: "ping", op: "ping", params: () => ({}) },
  { name: "revision", op: "revision", params: () => ({}), extras: scriptFigures },
  { name: "read_project structure", op: "read_project", params: () => ({ detail: "structure" }) },
  { name: "read_project full", op: "read_project", params: () => ({ detail: "full" }) },
  { name: "read_comp structure", op: "read_comp", params: (target) => ({ compId: target.compId, detail: "structure" }) },
  { name: "read_comp full", op: "read_comp", params: (target) => ({ compId: target.compId, detail: "full" }) },
  { name: "read_paths", op: "read_paths", params: (target) => ({ targets: [{ compId: target.compId, layerId: target.layerId, path: target.path }] }) },
  { name: "hash_project", op: "hash_project", params: () => ({}) },
];

async function sample(client: Pick<NativeClient, "request">, spec: BenchOpSpec, target: BenchTarget): Promise<Taken> {
  const { response, rttMs } = await client.request(spec.op, spec.params(target));
  if (!response.ok) return { error: response.error ?? { code: "UNKNOWN", message: "no error body" } };
  return { sample: { rttMs, timing: response.timing ?? {}, extras: spec.extras?.(response.result) } };
}

function extraStats(samples: ReadonlyArray<Sample>): Pick<WarmStats, "revisionUs" | "floorUs"> {
  if (!samples[0]?.extras) return {};
  return {
    revisionUs: summarize(samples.map((entry) => entry.extras?.revisionUs)),
    floorUs: summarize(samples.map((entry) => entry.extras?.floorUs)),
  };
}

/** The summaries of every timing figure, plus the script figures when the samples carry them. */
export function summarizeSamples(samples: ReadonlyArray<Sample>): WarmStats {
  const timing = samples.map((entry) => entry.timing);
  return {
    rttMs: summarize(samples.map((entry) => entry.rttMs)),
    totalMainThreadMs: summarize(timing.map((entry) => entry.totalMainThreadMs)),
    queuedMs: summarize(timing.map((entry) => entry.queuedMs)),
    walkMs: summarize(timing.map((entry) => entry.walkMs)),
    hashMs: summarize(timing.map((entry) => entry.hashMs)),
    serializeMs: summarize(timing.map((entry) => entry.serializeMs)),
    bytes: summarize(timing.map((entry) => entry.bytes)),
    getterCalls: summarize(timing.map((entry) => entry.getterCalls)),
    ...extraStats(samples),
  };
}

function dispatchedBy(samples: ReadonlyArray<Sample>): ReadonlyArray<string> {
  return [...new Set(samples.flatMap((entry) => (entry.timing.dispatchedBy === undefined ? [] : [entry.timing.dispatchedBy])))];
}

/** Runs one op `runs` times; the first sample is reported as cold, the rest as warm statistics. */
export async function benchOp(client: Pick<NativeClient, "request">, spec: BenchOpSpec, options: BenchOptions): Promise<OpResult> {
  const samples: Sample[] = [];
  for (let run = 0; run < options.runs; run += 1) {
    const taken = await sample(client, spec, options.target);
    if ("error" in taken) return { name: spec.name, op: spec.op, error: taken.error, runs: samples.length };
    samples.push(taken.sample);
  }
  const [cold] = samples;
  if (!cold) return { name: spec.name, op: spec.op, error: { code: "NO_RUNS", message: "no run was requested" }, runs: 0 };
  const warm = samples.length > 1 ? samples.slice(1) : samples;
  return { name: spec.name, op: spec.op, runs: samples.length, cold, warm: summarizeSamples(warm), dispatchedBy: dispatchedBy(samples) };
}

/** Every op of BENCH_OPS in order. */
export async function benchAllOps(client: Pick<NativeClient, "request">, options: BenchOptions): Promise<ReadonlyArray<OpResult>> {
  const ops: OpResult[] = [];
  for (const spec of BENCH_OPS) ops.push(await benchOp(client, spec, options));
  return ops;
}

/** True for an op that answered an error. */
export function isFailure(entry: OpResult): entry is OpFailure {
  return "error" in entry;
}

/** True for an op measured over all its runs. */
export function isSuccess(entry: OpResult): entry is OpSuccess {
  return !isFailure(entry);
}

function warmMedian(ops: ReadonlyArray<OpResult>, name: string, pick: (warm: WarmStats) => Summary | undefined): number | null {
  const entry = ops.find((candidate) => candidate.name === name);
  return entry && isSuccess(entry) ? (pick(entry.warm)?.p50 ?? null) : null;
}

function difference(larger: number | null, smaller: number | null): number | null {
  return larger === null || smaller === null ? null : larger - smaller;
}

/** Transport floor and idle-hook latency: what a trivial request costs without and with the AE main-thread hop. */
export function deriveLatencies(ops: ReadonlyArray<OpResult>): Latencies {
  const direct = warmMedian(ops, "ping_direct", (warm) => warm.rttMs);
  const hopped = warmMedian(ops, "ping", (warm) => warm.rttMs);
  return { transportFloorMs: direct, idleHookLatencyMs: difference(hopped, direct) };
}

/** What AEGP_ExecuteScript itself costs: `app.project.revision` against the trivial script `1`, in microseconds. */
export function deriveExecuteScript(ops: ReadonlyArray<OpResult>): ExecuteScriptCost {
  const revisionUsP50 = warmMedian(ops, "revision", (warm) => warm.revisionUs);
  const floorUsP50 = warmMedian(ops, "revision", (warm) => warm.floorUs);
  return { revisionUsP50, floorUsP50, deltaUs: difference(revisionUsP50, floorUsP50) };
}

/** The dispatch paths the main-thread ops were answered by ("idle"); socket answers are left out. */
export function seenDispatch(ops: ReadonlyArray<OpResult>): string {
  const seen = new Set(ops.flatMap((entry) => (isSuccess(entry) ? entry.dispatchedBy : [])));
  seen.delete("socket");
  return seen.size ? [...seen].sort().join("+") : "-";
}

/** Every derived figure of a run: latencies, the ExecuteScript cost and the dispatch paths seen. */
export function deriveAll(ops: ReadonlyArray<OpResult>): Derived {
  return { ...deriveLatencies(ops), executeScript: deriveExecuteScript(ops), dispatchedBy: seenDispatch(ops) };
}

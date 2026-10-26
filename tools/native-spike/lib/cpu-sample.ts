/** Samples a process's CPU time through ps. */
import { execFile } from "node:child_process";
import { SpikeError } from "./errors.ts";
import { summarize } from "./stats.ts";

const SECOND_MS = 1000;

/** Reads one ps line for a pid. */
export type PsRunner = (pid: number) => Promise<string>;

/** The callback `execFile` reports to: the failure, or the standard output. */
export type ExecFileCallback = (error: Error | null, stdout: string) => void;

/** The part of `execFile` the ps runner uses. */
export type ExecFileFunction = (file: string, args: ReadonlyArray<string>, callback: ExecFileCallback) => void;

/** The effects a CPU sample depends on: ps, the clock and sleeping. */
export interface CpuDeps {
  readonly runPs: PsRunner;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
}

/** One ps reading: %cpu and the cumulative cpu seconds (null when ps printed none). */
export interface CpuReading {
  readonly cpu: number;
  readonly cpuSeconds: number | null;
}

/** A reading with the time it was taken. */
export interface CpuSample extends CpuReading {
  readonly at: number;
}

/** The statistics of one sampled configuration. */
export interface CpuConfigResult {
  readonly config: "idle";
  readonly samples: number;
  readonly mean: number | null;
  readonly min: number | null;
  readonly max: number | null;
  readonly busyPercent: number | null;
}

/** The outcome of a CPU sample: the pid, the seconds sampled and one row per configuration. */
export interface CpuResult {
  readonly pid: number;
  readonly seconds: number;
  readonly configs: ReadonlyArray<CpuConfigResult>;
}

/** What a sample needs from the command line, and the pid to read. */
export interface CpuContext {
  readonly options: { readonly cpuSeconds: number };
  readonly pid: number | null;
}

interface TimedSample {
  readonly at: number;
  readonly cpuSeconds: number;
}

/** The real `ps` call: one line like " 3.4  1:02.50" (%cpu, then cumulative cpu time). */
export function psRunner(execFileImpl: ExecFileFunction = execFile): PsRunner {
  return (pid) => new Promise<string>((resolve, reject) => {
    execFileImpl("ps", ["-o", "%cpu=", "-o", "cputime=", "-p", String(pid)], (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

/** Seconds in a ps cputime string: [DD-][HH:]MM:SS[.ff]. Null when it is not one. */
export function parseCpuTime(text: string | undefined): number | null {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(text ?? "");
  if (!match) return null;
  const [, days = 0, hours = 0, minutes, seconds] = match;
  return ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds);
}

/** One ps line to {cpu, cpuSeconds}; blank or non-numeric output yields null. */
export function parsePs(text: string): CpuReading | null {
  const [first, second] = text.trim().split(/\s+/);
  const cpu = first === "" ? Number.NaN : Number(first);
  if (!Number.isFinite(cpu)) return null;
  return { cpu, cpuSeconds: parseCpuTime(second) };
}

/** The pid, or a CPU_NO_PID error when the discovery file had none. */
export function requirePid(pid: number | null): number {
  if (pid !== null && Number.isInteger(pid) && pid > 0) return pid;
  throw new SpikeError("CPU_NO_PID", "--cpu-sample needs the After Effects pid, but the discovery file has none. Restart After Effects with a plugin that writes \"pid\" to native.json.");
}

async function readPs(deps: CpuDeps, pid: number): Promise<CpuReading | null> {
  try { return parsePs(await deps.runPs(pid)); } catch (error) {
    throw new SpikeError("CPU_SAMPLE_FAILED", `ps could not read pid ${pid} (${error instanceof Error ? error.message : String(error)}); is After Effects still running?`);
  }
}

async function collect(deps: CpuDeps, spec: { readonly pid: number; readonly seconds: number }): Promise<ReadonlyArray<CpuSample>> {
  const samples: CpuSample[] = [];
  for (let index = 0; index < spec.seconds; index += 1) {
    if (index > 0) await deps.sleep(SECOND_MS);
    const taken = await readPs(deps, spec.pid);
    if (taken) samples.push({ ...taken, at: deps.now() });
  }
  return samples;
}

function timedSamples(samples: ReadonlyArray<CpuSample>): ReadonlyArray<TimedSample> {
  return samples.flatMap((entry) => (entry.cpuSeconds === null ? [] : [{ at: entry.at, cpuSeconds: entry.cpuSeconds }]));
}

function busyPercent(samples: ReadonlyArray<CpuSample>): number | null {
  const timed = timedSamples(samples);
  const first = timed[0];
  const last = timed.at(-1);
  if (timed.length < 2 || !first || !last) return null;
  const wallSeconds = (last.at - first.at) / SECOND_MS;
  return wallSeconds > 0 ? ((last.cpuSeconds - first.cpuSeconds) / wallSeconds) * 100 : null;
}

/** Mean, extremes and the cputime-based busy percentage of the samples. */
export function summarizeCpu(samples: ReadonlyArray<CpuSample>): Omit<CpuConfigResult, "config"> {
  const stats = summarize(samples.map((entry) => entry.cpu));
  return { samples: stats.n, mean: stats.mean, min: stats.min, max: stats.max, busyPercent: busyPercent(samples) };
}

/** Samples AE's CPU once per second for `options.cpuSeconds` seconds while no request is sent: the idle baseline. */
export async function runCpuSample(context: CpuContext, deps: CpuDeps): Promise<CpuResult> {
  const pid = requirePid(context.pid);
  const seconds = context.options.cpuSeconds;
  const sampled = summarizeCpu(await collect(deps, { pid, seconds }));
  return { pid, seconds, configs: [{ config: "idle", ...sampled }] };
}

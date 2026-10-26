/** Formats CPU samples as text. */
import type { CpuConfigResult, CpuResult } from "./cpu-sample.ts";
import { formatTable } from "./format.ts";

const pct = (value: number | null): string => (value === null ? "-" : value.toFixed(1));

function row(entry: CpuConfigResult): ReadonlyArray<string> {
  return [entry.config, String(entry.samples), pct(entry.mean), pct(entry.min), pct(entry.max), pct(entry.busyPercent)];
}

/** The human report of a CPU sample: what was sampled and one row. */
export function cpuLines(cpu: CpuResult): ReadonlyArray<string> {
  return [
    `cpu sample of pid ${cpu.pid}: ${cpu.seconds} samples, one per second, no requests sent while sampling.`,
    formatTable(["config", "samples", "mean %cpu", "min %cpu", "max %cpu", "busy % (cputime)"], cpu.configs.map(row)),
    "ps %cpu may be a lifetime or decayed average rather than current usage; busy % is the cumulative cpu time delta over the sampled wall time and is the figure to trust.",
  ];
}

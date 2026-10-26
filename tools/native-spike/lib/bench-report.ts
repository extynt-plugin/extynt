/** Formats a benchmark result as text. */
import type { BenchRun } from "./bench-run.ts";
import type { BenchTarget } from "./bench-target.ts";
import { coldTable, executeScriptLine, warmTable } from "./bench-table.ts";
import { cpuLines } from "./cpu-report.ts";
import type { CpuResult } from "./cpu-sample.ts";
import { fmtMs } from "./format.ts";

function targetLines(target: BenchTarget): ReadonlyArray<string> {
  return [
    `target comp:  ${target.compName} (id ${target.compId}, ${target.layerCount} layers)`,
    `target layer: ${target.layerName} (id ${target.layerId})`,
    `target path:  ${target.path}`,
  ];
}

function singleLines(run: BenchRun): ReadonlyArray<string> {
  const lines = [`warm runs (runs=${run.runs}, first run excluded; times in ms):`];
  lines.push(warmTable(run.ops), "", "cold (first run):", coldTable(run.ops), "");
  const { transportFloorMs, idleHookLatencyMs } = run.derived;
  lines.push(`transport floor (ping_direct rtt p50): ${fmtMs(transportFloorMs)} ms`);
  lines.push(`idle-hook latency (ping p50 - ping_direct p50): ${fmtMs(idleHookLatencyMs)} ms`);
  lines.push(executeScriptLine(run.derived));
  return lines;
}

/** The human report: the bench tables (when the bench ran) and the CPU sample (when it was taken). */
export function formatBench(bench: BenchRun | undefined, cpu: CpuResult | undefined): string {
  const lines: string[] = [];
  if (bench) lines.push(...targetLines(bench.target), "", ...singleLines(bench));
  if (cpu) lines.push(...(lines.length ? [""] : []), ...cpuLines(cpu));
  return lines.join("\n");
}

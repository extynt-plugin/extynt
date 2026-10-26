// The typecheck stage: one tsc build over every project under the strict flags, with the error count reported per area instead of the raw wall of errors.
import { areaOf } from "./areas.ts";
import { runCommand } from "./stage-runner.ts";
import type { StageResult } from "./stage-runner.ts";
import { errorsByProject, optInLine, projectStatus, ratchetViolations, writeStrictLayer } from "./strict-projects.ts";

const ERROR_LINE = /^(\S[^(]*)\(\d+,\d+\): error (TS\d+)/;

/** The number of tsc errors in one area. */
export interface AreaCount {
  readonly area: string;
  readonly count: number;
}

/** The number of tsc errors with one TS code. */
export interface CodeCount {
  readonly code: string;
  readonly count: number;
}

/** [{ area, count }] sorted by count, for the error lines of tsc output. */
export function errorsByArea(output: string): AreaCount[] {
  const counts = new Map<string, number>();
  for (const line of output.split(/\r?\n/)) {
    const file = ERROR_LINE.exec(line)?.[1];
    if (file === undefined) continue;
    const area = areaOf(file.replaceAll("\\", "/"));
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  return [...counts].map(([area, count]) => ({ area, count })).sort((left, right) => right.count - left.count);
}

/** [{ code, count }] sorted by count, for the error codes of tsc output. */
export function errorsByCode(output: string): CodeCount[] {
  const counts = new Map<string, number>();
  for (const line of output.split(/\r?\n/)) {
    const code = ERROR_LINE.exec(line)?.[2];
    if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts].map(([code, count]) => ({ code, count })).sort((left, right) => right.count - left.count);
}

/** The headline lines of a failed typecheck: total, per area, per error code. */
export function typecheckHeadline(output: string): string[] {
  const areas = errorsByArea(output);
  const total = areas.reduce((sum, row) => sum + row.count, 0);
  const codes = errorsByCode(output).slice(0, 6).map((row) => `${row.code}=${row.count}`).join(" ");
  return [`${total} type error(s) in ${areas.length} area(s); codes: ${codes}`, ...areas.map((row) => `${row.area}: ${row.count} error(s)`)];
}

/** Runs the strict layer over every project; a failure carries the per-area summary, the opt-in line and any ratchet violations. */
export async function typecheckStage(): Promise<StageResult> {
  const root = writeStrictLayer();
  const result = await runCommand({ command: "pnpm", args: ["exec", "tsc", "-b", root, "--pretty", "false"], label: "typecheck" });
  const status = projectStatus();
  const ratchet = ratchetViolations(status, errorsByProject(result.output, status.map((project) => project.dir)));
  const errors = result.output.split(/\r?\n/).filter((line) => ERROR_LINE.test(line));
  const headline = [...(errors.length ? typecheckHeadline(result.output) : []), optInLine(status)];
  if (result.ok && !ratchet.length) return { ...result, output: `${result.output}\n${optInLine(status)}` };
  return { ...result, ok: false, failures: [...errors, ...ratchet], headline };
}

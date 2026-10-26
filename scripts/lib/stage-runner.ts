// Runs the gate's stages in order: one PASS or FAIL line each, full output kept under .check-logs.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, rel } from "./sources.ts";

const SHOWN_FAILURES = 12;
const SHOWN_TAIL_LINES = 18;
const COUNTS_PATTERN = /(?:ℹ\s+)?tests[= ](\d+)[\s\S]*?(?:ℹ\s+)?pass[= ](\d+)[\s\S]*?(?:ℹ\s+)?fail[= ](\d+)/g;

/** Where each stage writes its full output; created on first use. */
export const LOG_DIR = join(ROOT, ".check-logs");

/** What a stage reports: pass or fail, its combined output, and the optional timing, counts, summary, log path and violation lists. */
export interface StageResult {
  readonly ok: boolean;
  readonly output: string;
  readonly duration?: number;
  readonly counts?: string;
  readonly summary?: string | undefined;
  readonly log?: string;
  readonly failures?: ReadonlyArray<string>;
  readonly headline?: ReadonlyArray<string>;
}

/** A stage body: synchronous or asynchronous, resolving to its result or throwing a GateFailure. */
export type StageTask = () => StageResult | Promise<StageResult>;

/** A stage label with its body, in the order the gate runs them. */
export type LabelledStage = readonly [label: string, task: StageTask];

/** What a command stage needs to run: the program, its arguments, the log name, and the environment (the process's own by default). */
export interface CommandSpec {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly label: string;
  readonly env?: NodeJS.ProcessEnv;
}

/** Which stages to run and how: the optional label filter and whether a failure stops the run. */
export interface RunPlan {
  readonly stages: ReadonlyArray<LabelledStage>;
  readonly only?: ReadonlySet<string> | null;
  readonly keepGoing?: boolean;
}

/** A stage failure carrying every violation, one line each, and optional headline lines (such as per-area counts) shown first. */
export class GateFailure extends Error {
  readonly failures: ReadonlyArray<string>;
  readonly headline: ReadonlyArray<string>;

  constructor(failures: ReadonlyArray<string>, headline: ReadonlyArray<string> = []) {
    super([...headline, ...failures].join("\n"));
    this.failures = failures;
    this.headline = headline;
  }
}

/** Throws a GateFailure when there are failures, else returns the count of files checked. */
export function failOn(failures: ReadonlyArray<string>, count: number, headline: ReadonlyArray<string> = []): number {
  if (failures.length) throw new GateFailure(failures, headline);
  return count;
}

/** The success result of a stage that checked `count` files. */
export function passed(label: string, count: number): StageResult {
  return { ok: true, output: `files=${count}`, log: join(LOG_DIR, `${label}.log`) };
}

function testCounts(output: string): string {
  const match = [...output.matchAll(COUNTS_PATTERN)].at(-1);
  return match ? ` tests=${match[1]} pass=${match[2]} fail=${match[3]}` : "";
}

/** Runs a command to completion and resolves to a stage result with its combined output. */
export function runCommand({ command, args, label, env = process.env }: CommandSpec): Promise<StageResult> {
  return new Promise((resolveRun) => {
    const started = Date.now();
    const child = spawn(command, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("close", (code) => {
      const output = Buffer.concat(chunks).toString("utf8");
      resolveRun({ ok: code === 0, duration: Date.now() - started, counts: testCounts(output), output, log: join(LOG_DIR, `${label}.log`) });
    });
  });
}

function failureLines(result: StageResult): string[] {
  if (result.failures) {
    const more = result.failures.length - SHOWN_FAILURES;
    const head = result.failures.slice(0, SHOWN_FAILURES);
    return [`${result.failures.length} violation(s)`, ...(result.headline ?? []), ...head, ...(more > 0 ? [`... ${more} more`] : [])];
  }
  return result.output.trim().split(/\r?\n/).slice(-SHOWN_TAIL_LINES);
}

function printResult(label: string, result: StageResult): void {
  const summary = result.summary ? ` ${result.summary}` : "";
  console.log(`${result.ok ? "PASS" : "FAIL"} ${label} ${result.duration}ms${result.counts ?? ""}${summary}`);
  if (result.ok) return;
  console.log(failureLines(result).join("\n"));
  if (result.log) console.log(`log=${rel(result.log)}`);
}

function failureResult(label: string, error: Error | string, started: number): StageResult {
  const log = join(LOG_DIR, `${label}.log`);
  const duration = Date.now() - started;
  if (error instanceof GateFailure) {
    writeFileSync(log, `${error.message}\n`);
    return { ok: false, duration, output: error.message, failures: error.failures, headline: error.headline, log };
  }
  const output = error instanceof Error ? error.message : error;
  writeFileSync(log, `${error instanceof Error ? error.stack : output}\n`);
  return { ok: false, duration, output, log };
}

async function runStage(label: string, task: StageTask): Promise<StageResult> {
  const started = Date.now();
  try {
    const result = await task();
    const duration = result.duration || Date.now() - started;
    if (!result.output) return { ...result, duration };
    const log = join(LOG_DIR, `${label}.log`);
    writeFileSync(log, `${result.output}\n`);
    return { ...result, duration, log };
  } catch (error) {
    return failureResult(label, error instanceof Error ? error : String(error), started);
  }
}

/** Runs the named stages in order; stops at the first failure unless keepGoing. Resolves to true when every stage passed. */
export async function runStages({ stages, only, keepGoing }: RunPlan): Promise<boolean> {
  mkdirSync(LOG_DIR, { recursive: true });
  let allPassed = true;
  for (const [label, task] of stages) {
    if (only && !only.has(label)) continue;
    const result = await runStage(label, task);
    printResult(label, result);
    allPassed &&= result.ok;
    if (!allPassed && !keepGoing) break;
  }
  return allPassed;
}

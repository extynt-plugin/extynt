/** Runs the benchmark over the chosen operations. */
import { benchAllOps, deriveAll, isFailure } from "./bench.ts";
import type { Derived, OpResult } from "./bench.ts";
import { chooseTarget } from "./bench-target.ts";
import type { BenchTarget, TargetOptions } from "./bench-target.ts";
import type { NativeClient } from "./client.ts";

/** The options that steer a run: how many requests per op and where to aim. */
export interface RunOptions extends TargetOptions {
  readonly runs: number;
}

/** The measured target, every op's outcome and the figures derived from them. */
export interface BenchRun {
  readonly target: BenchTarget;
  readonly runs: number;
  readonly ops: ReadonlyArray<OpResult>;
  readonly derived: Derived;
}

/** Chooses the target from a structure read, then times every op once. */
export async function runBench(client: Pick<NativeClient, "call" | "request">, options: RunOptions): Promise<BenchRun> {
  const structure = await client.call("read_project", { detail: "structure" });
  const target = chooseTarget(structure.response.result, options);
  const ops = await benchAllOps(client, { runs: options.runs, target });
  return { target, runs: options.runs, ops, derived: deriveAll(ops) };
}

/** True when any measured op answered an error. */
export function hasOpErrors(bench: BenchRun | undefined): boolean {
  return bench?.ops.some(isFailure) ?? false;
}

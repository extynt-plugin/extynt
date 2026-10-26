#!/usr/bin/env node
// Supervised read_paths stream for the UI stability pass. Run with --help for usage.
import { describeError, exitCodeOf } from "./lib/errors.ts";
import { STABILITY_USAGE, formatStability, parseStabilityArgs, runStability } from "./lib/stability.ts";

try {
  const options = parseStabilityArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(STABILITY_USAGE);
  } else {
    const summary = await runStability(options);
    process.stdout.write(`${formatStability(summary, options.slowMs)}\n`);
    process.exitCode = summary.errors.length ? 1 : 0;
  }
} catch (error) {
  const failure = error instanceof Error ? error : String(error);
  process.stderr.write(`${describeError(failure)}\n`);
  process.exitCode = exitCodeOf(failure);
}

#!/usr/bin/env node
// The repository gate: structure, comments, style, build and every test suite, one PASS or FAIL line per stage.
import { commandStages } from "./lib/command-stages.ts";
import type { CommandStageLabel } from "./lib/command-stages.ts";
import { fileStages } from "./lib/file-stages.ts";
import type { FileStageLabel } from "./lib/file-stages.ts";
import { nodeVersionProblem } from "./lib/node-version.ts";
import { pathGlobs, pathScope } from "./lib/path-filter.ts";
import { ROOT } from "./lib/sources.ts";
import { runStages } from "./lib/stage-runner.ts";
import type { LabelledStage } from "./lib/stage-runner.ts";

const STAGE_ORDER: ReadonlyArray<CommandStageLabel | FileStageLabel> = [
  "tools", "architecture", "panel-integrity", "metrics", "comments", "header-length", "dead-exports", "unknown-boundary", "native-metrics", "whitespace", "format",
  "banned-tokens", "shell", "build", "lint", "typecheck", "workspace-tests", "headless-validation", "native-core",
];

function optionList(argv: ReadonlyArray<string>, name: string): Set<string> | null {
  const index = argv.indexOf(name);
  return index < 0 ? null : new Set((argv[index + 1] ?? "").split(",").filter(Boolean));
}

function orderedStages(argv: ReadonlyArray<string>): LabelledStage[] {
  const globs = pathGlobs(argv);
  const stages = { ...fileStages(pathScope(globs)), ...commandStages(globs.length ? ["--paths", globs.join(",")] : []) };
  return STAGE_ORDER.map((label) => [label, stages[label]]);
}

const problem = nodeVersionProblem(process.version, ROOT);
if (problem) {
  console.error(`FAIL node-version ${problem}`);
  process.exit(1);
}
const argv = process.argv.slice(2);
const passed = await runStages({ stages: orderedStages(argv), only: optionList(argv, "--only"), keepGoing: argv.includes("--keep-going") });
process.exitCode = passed ? 0 : 1;

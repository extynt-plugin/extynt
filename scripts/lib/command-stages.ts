// The whole-repository gate stages: tool preflight, architecture, bundle integrity, build, lint, tests and the native core.
import { spawnSync } from "node:child_process";
import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { architectureFailures } from "./import-graph.ts";
import { callbackFailures, includeFailures } from "./cpp-rules.ts";
import { nativeCoreStage } from "./native-core.ts";
import { ROOT, maintainedFiles, nativeFiles, rel } from "./sources.ts";
import { LOG_DIR, failOn, passed, runCommand } from "./stage-runner.ts";
import type { StageResult, StageTask } from "./stage-runner.ts";
import { typecheckStage } from "./typecheck.ts";
import { requireTools } from "./tools.ts";
import { testArguments, testEnvironment } from "../run-tests.ts";

/** The labels of the whole-repository stages, in no particular order. */
export type CommandStageLabel =
  | "tools" | "architecture" | "panel-integrity" | "build" | "lint"
  | "typecheck" | "workspace-tests" | "headless-validation" | "native-core";

interface BuiltPanel {
  readonly main: string;
  readonly manifest: string;
}

const QUALITY_TOOLS = ["lizard", "clang-format", "clang-tidy", "shellcheck"];
const HEADLESS_PATTERNS = ["apps/panel/dist/tests/*.test.js", "tools/chat-tests/dist/tests/fake-host*.test.js", "tools/chat-tests/dist/tests/fake-plugin*.test.js"];

function toolsStage(): StageResult {
  const found = requireTools(QUALITY_TOOLS);
  return { ok: true, output: QUALITY_TOOLS.map((name) => `${name}=${found.get(name)}`).join("\n"), summary: `tools=${QUALITY_TOOLS.length}` };
}

function architectureStage(): StageResult {
  const files = maintainedFiles();
  const native = nativeFiles().map((file) => ({ key: rel(file), text: readFileSync(file, "utf8") }));
  const failures = [...architectureFailures(files), ...includeFailures(native), ...callbackFailures(native)];
  return passed("architecture", failOn(failures, files.length + native.length));
}

function buildPanelOnce(mainPath: string, manifestPath: string): BuiltPanel {
  const result = spawnSync(process.execPath, [join(ROOT, "scripts", "build-panel.ts")], { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`panel bundle generation failed: ${result.stderr || result.stdout}`);
  return { main: readFileSync(mainPath, "utf8"), manifest: readFileSync(manifestPath, "utf8") };
}

function panelIntegrityStage(): StageResult {
  const mainPath = join(ROOT, "apps", "panel", "main.js");
  const manifestPath = join(ROOT, "apps", "panel", "ui-manifest.json");
  const first = buildPanelOnce(mainPath, manifestPath);
  const second = buildPanelOnce(mainPath, manifestPath);
  if (first.main !== second.main) throw new Error("apps/panel/main.js is not a reproducible output of scripts/build-panel.ts");
  if (first.manifest !== second.manifest) throw new Error("apps/panel/ui-manifest.json is not a reproducible output of scripts/build-panel.ts");
  return { ok: true, output: `bytes=${first.main.length}` };
}

function headlessArguments(): string[] {
  const files = HEADLESS_PATTERNS.flatMap((pattern) => {
    const matches = globSync(pattern, { cwd: ROOT });
    if (!matches.length) throw new Error(`headless-validation pattern matched no file: ${pattern}`);
    return matches;
  });
  return testArguments(files);
}

async function nativeCore(): Promise<StageResult> {
  const result = await nativeCoreStage({ root: ROOT, logDir: LOG_DIR });
  return { ok: result.ok, output: result.output, summary: result.summary };
}

function pnpmStage(script: string, argv: ReadonlyArray<string> = []): StageTask {
  return () => runCommand({ command: "pnpm", args: [script, ...argv], label: script === "test" ? "workspace-tests" : script });
}

/** The whole-repository stages keyed by label; `lintArguments` carries --paths through to the lint stage. */
export function commandStages(lintArguments: ReadonlyArray<string>): Readonly<Record<CommandStageLabel, StageTask>> {
  return {
    tools: toolsStage,
    architecture: architectureStage,
    "panel-integrity": panelIntegrityStage,
    build: pnpmStage("build"),
    lint: pnpmStage("lint", lintArguments),
    typecheck: typecheckStage,
    "workspace-tests": pnpmStage("test"),
    "headless-validation": () => runCommand({ command: process.execPath, args: headlessArguments(), label: "headless-validation", env: testEnvironment(process.env) }),
    "native-core": nativeCore,
  };
}

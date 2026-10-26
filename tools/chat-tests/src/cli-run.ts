/** The `run` and `trace` commands: pick the provider, run the scenarios, print what happened and keep the traces. */
import { writeFileSync } from "node:fs";
import { appendLedger, ledgerRow, repositoryRevision, type EvidenceMode } from "./benchmark-ledger.js";
import type { CliArgs } from "./cli-args.js";
import { boundedElapsedMs, elapsedSecondsText } from "./clock.js";
import { availableProfileFiles, defaultProfileDirectory, describeCapabilityHealth, describeSeeding } from "./host-profile.js";
import { startTracedSidecar } from "./inprocess.js";
import { liveEnvironment } from "./live-environment.js";
import { formatRun, formatVerdict, runScenarios, type RunOptions } from "./run.js";
import type { ScenarioRun } from "./run-types.js";
import { numberMember } from "./wire-reads.js";
import { SCENARIOS } from "./scenarios.js";
import type { ChatTestProvider } from "./sidecar-spawn.js";
import type { Trace, TraceRecord } from "./trace.js";
import { DEFAULT_TRACE_DIRECTORY, saveRunTraces } from "./trace-save.js";

const say = (text: string): void => { process.stdout.write(text); };

interface Collected { traces: Map<string, TraceRecord[]> }

function keepTrace(args: CliArgs, collected: Collected, run: ScenarioRun, handle: { trace?: Trace | undefined }): void {
  const trace = handle.trace;
  if (!trace) return;
  collected.traces.set(run.scenario.id, [...trace.records]);
  const full = trace.render({ systemPreviewChars: Number.POSITIVE_INFINITY });
  run.transcript = args.hasFlag("--full-prompt") ? full : trace.render();
  trace.reset();
}

function endpointError(args: CliArgs, tracing: boolean): string | undefined {
  const pluginEndpoint = args.valueOf("--plugin-endpoint");
  if (args.hasFlag("--plugin-endpoint") && !pluginEndpoint) return "--plugin-endpoint needs the path to the plugin's native.json.";
  const conflicts = args.hasFlag("--fake-host") || tracing;
  return pluginEndpoint && conflicts ? "--plugin-endpoint talks to a real plugin; it cannot be combined with --fake-host or trace." : undefined;
}

function flagError(args: CliArgs, tracing: boolean): string | undefined {
  if (args.hasFlag("--fixture-readback") && !args.hasFlag("--fake-host")) return "--fixture-readback requires --fake-host; it never describes a real After Effects readback.";
  const endpoint = endpointError(args, tracing);
  if (endpoint) return endpoint;
  return !args.hasFlag("--live") && args.valueOf("--model") ? "--model only applies to a live run; add --live." : undefined;
}

function providerFor(args: CliArgs): ChatTestProvider | string {
  if (!args.hasFlag("--live")) return { kind: "mock" };
  const environment = liveEnvironment();
  const model = args.valueOf("--model");
  if (model) environment.AE_LLM_MODEL = model;
  if (!environment.AE_LLM_PROVIDER) return "No AE_LLM_PROVIDER in the repo .env, so there is no model to test against. Add one, or run without --live for the offline scenarios.";
  return { kind: "live", environment };
}

function printHeader(args: CliArgs, provider: ChatTestProvider, ids: readonly string[]): void {
  const model = args.valueOf("--model");
  const label = provider.kind === "live" ? `Live chat tests (${provider.environment.AE_LLM_PROVIDER}${model ? ` / ${model}` : ""})` : "Offline chat tests";
  say(`${label}: ${ids.length} scenario(s)${args.command === "trace" ? ", recording the full turn" : ""}\n`);
  if (args.hasFlag("--fake-host")) say("Evidence mode: headless fixture readback (not real After Effects verification)\n");
  if (args.valueOf("--plugin-endpoint")) say("Evidence mode: real plugin (the open project is used as is; fixture-only checks are skipped)\n");
  const profileSource = args.valueOf("--profile") ?? defaultProfileDirectory();
  say(`${describeSeeding(availableProfileFiles(profileSource))}\n`);
  const warning = describeCapabilityHealth(profileSource);
  if (warning) say(`WARNING: ${warning}\n`);
}

function runOptions(args: CliArgs, collected: Collected): RunOptions {
  const tracing = args.command === "trace";
  const pluginEndpoint = args.valueOf("--plugin-endpoint");
  const timeout = args.valueOf("--timeout");
  const profileDirectory = args.valueOf("--profile");
  return {
    quiet: args.hasFlag("--quiet") || tracing,
    watch: args.hasFlag("--watch"),
    ...(args.hasFlag("--fake-host") ? { fakeHost: true } : {}),
    ...(pluginEndpoint ? { pluginEndpoint } : {}),
    profileDirectory,
    ...(timeout ? { timeoutMs: Math.max(1, Number(timeout)) * 1000 } : {}),
    ...(tracing ? {
      start: (selected: ChatTestProvider) => startTracedSidecar(selected, { profileDirectory }),
      afterEach: (run: ScenarioRun, handle: { trace?: Trace | undefined }) => keepTrace(args, collected, run, handle),
    } : {}),
  };
}

function printTraceRuns(args: CliArgs, runs: readonly ScenarioRun[]): void {
  for (const run of runs) {
    if (run.skipped) { say(`\n=== ${run.scenario.id}: SKIPPED — ${run.skipped} ===\n`); continue; }
    say(`\n########## ${run.scenario.id} ##########\n${run.transcript ?? "(no transcript was recorded)"}\n`);
    if (run.report) say(`${formatVerdict(run)}\n`);
    else if (run.failures.length) say(`RESULT: FAIL\n  - ${run.failures.join("\n  - ")}\n`);
  }
  const out = args.valueOf("--out");
  if (out) { writeFileSync(out, runs.map((run) => `########## ${run.scenario.id} ##########\n${run.transcript ?? ""}\n`).join("\n")); say(`\nTranscript written to ${out}\n`); }
  const jsonl = args.valueOf("--jsonl");
  if (jsonl) {
    writeFileSync(jsonl, `${runs.map((run) => JSON.stringify({ scenario: run.scenario.id, failures: run.failures, transcript: run.transcript ?? "", storedOperations: run.storedOperations ?? [] })).join("\n")}\n`);
    say(`Records written to ${jsonl}\n`);
  }
}

function printRuns(args: CliArgs, runs: readonly ScenarioRun[]): void {
  if (args.hasFlag("--json")) say(`${JSON.stringify(runs.map((run) => ({ id: run.scenario.id, skipped: run.skipped, failures: run.failures, report: run.report, logLines: run.logLines })), null, 1)}\n`);
  else if (args.command === "trace") printTraceRuns(args, runs);
  else for (const run of runs) say(`${formatRun(run)}\n`);
}

function appendRunLedger(args: CliArgs, runs: readonly ScenarioRun[], context: { runId: string; collected: Collected }): void {
  const ledgerPath = args.valueOf("--ledger");
  if (!ledgerPath) return;
  const evidenceMode: EvidenceMode = args.valueOf("--plugin-endpoint") ? "live-host-structural" : args.hasFlag("--fake-host") ? "headless-fixture-readback" : "planning-only";
  const revision = repositoryRevision();
  const rows = runs
    .filter((run) => !run.skipped)
    .map((run) => ledgerRow(run, { runId: context.runId, evidenceMode, traceRecords: context.collected.traces.get(run.scenario.id) }, revision));
  appendLedger(ledgerPath, rows);
  say(`Benchmark ledger: appended ${rows.length} row(s) to ${ledgerPath}\n`);
}

function saveTraces(args: CliArgs, runs: readonly ScenarioRun[], context: { runId: string; collected: Collected }): void {
  if (args.hasFlag("--no-trace")) return;
  const directory = args.valueOf("--trace-dir") ?? DEFAULT_TRACE_DIRECTORY;
  try {
    const written = saveRunTraces({ directory, runId: context.runId, runs, traced: context.collected.traces });
    if (written.length) say(`Traces: saved ${written.length} file(s) under ${directory}/${context.runId}\n`);
  } catch (error) {
    say(`WARNING: the traces could not be saved under ${directory}: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

function summaryLine(runs: readonly ScenarioRun[], elapsedMs: number | undefined): string {
  const ran = runs.filter((run) => !run.skipped);
  const failed = runs.filter((run) => run.failures.length);
  const cutOff = runs.filter((run) => run.report?.cutOff);
  const tokens = ran.reduce((sum, run) => sum + ((run.report?.usage && numberMember(run.report.usage, "totalTokens")) || 0), 0);
  const cuts = cutOff.length ? ` (${cutOff.length} of them cut off — ${cutOff.map((run) => run.report?.cutOff).join(", ")} — not a verdict on the agent)` : "";
  return `\n${ran.length} ran, ${runs.length - ran.length} skipped, ${failed.length} failed${cuts} in ${elapsedSecondsText(elapsedMs, 1)}${tokens ? `, ${tokens} tokens` : ""}\n`;
}

/** Runs the selected scenarios (`run`) or records them in full (`trace`) and returns the exit code. */
export async function runCommand(args: CliArgs): Promise<number> {
  const tracing = args.command === "trace";
  const problem = flagError(args, tracing);
  if (problem) { say(`${problem}\n`); return 2; }
  const provider = providerFor(args);
  if (typeof provider === "string") { say(`${provider}\n`); return 2; }
  const ids = args.scenarioIds.length ? args.scenarioIds : SCENARIOS.map((scenario) => scenario.id);
  printHeader(args, provider, ids);
  const started = Date.now();
  const collected: Collected = { traces: new Map() };
  const runs = await runScenarios(ids, provider, runOptions(args, collected));
  const context = { runId: `bench-${new Date(started).toISOString().replace(/[^0-9TZ]/g, "")}-${process.pid}`, collected };
  appendRunLedger(args, runs, context);
  saveTraces(args, runs, context);
  printRuns(args, runs);
  say(summaryLine(runs, boundedElapsedMs(started)));
  return runs.some((run) => run.failures.length) ? 1 : 0;
}

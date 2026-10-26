/**
 * Runs chat scenarios and reports what the agent did. The interesting output is structural —
 * which layer a plan targets, which property paths the model asked for — and it comes from the
 * sidecar's `agent.tool` log lines, the only place the real operation bodies are visible.
 */
import type { ProjectSnapshot } from "@extynt/project-graph";
import { compositionAsset, freshProbe } from "./assets.js";
import { fixtureSnapshotFromProbe } from "./fake-host-probe.js";
import { startFakePluginHost, type AppliedBatch, type FakePluginHost } from "./fake-plugin-host.js";
import { untilEndpointRead, untilRead } from "./fake-plugin-wait.js";
import { isolatedProfileDirectory } from "./host-profile.js";
import { factFailures, type FactContext } from "./project-facts.js";
import { checkExpectations } from "./run-expect.js";
import { mergedReport, reportFromResponse } from "./run-report.js";
import { planStoreRows, recalledOperations } from "./run-store.js";
import { runScenarioTurn, type TurnSettings } from "./run-turn.js";
import type { ScenarioReport, ScenarioRun, TurnRecord } from "./run-types.js";
import { SCENARIOS, type Scenario } from "./scenarios.js";
import type { SidecarHandle } from "./sidecar-client.js";
import { startSidecar } from "./sidecar.js";
import type { ChatTestProvider } from "./sidecar-spawn.js";
import type { Trace } from "./trace.js";

export { checkExpectations, targetingHaystack } from "./run-expect.js";
export { formatRun, formatVerdict } from "./run-format.js";
export type { PlanCard, PlanStoreRow, ScenarioReport, ScenarioRun, ToolTrace, TurnRecord } from "./run-types.js";

type RunHandle = SidecarHandle & { trace?: Trace | undefined };

/** How a run is driven. */
export interface RunOptions {
  quiet?: boolean;
  timeoutMs?: number;
  start?: (provider: ChatTestProvider) => Promise<RunHandle>;
  profileDirectory?: string | undefined;
  fakeHost?: boolean;
  pluginEndpoint?: string | undefined;
  afterEach?: (run: ScenarioRun, handle: RunHandle) => void;
  watch?: boolean;
}

const LIVE_SCENARIO_TIMEOUT_MS = 600_000;
const MOCK_SCENARIO_TIMEOUT_MS = 30_000;

interface Hosting { host?: FakePluginHost; current?: ScenarioRun }

interface ScenarioContext { sidecar: RunHandle; provider: ChatTestProvider; options: RunOptions; turnSettings: TurnSettings; hosting: Hosting }

function startPlain(options: RunOptions): (provider: ChatTestProvider) => Promise<RunHandle> {
  return (provider) =>
    startSidecar(provider, { profileDirectory: options.profileDirectory, ...(options.pluginEndpoint ? { pluginEndpoint: options.pluginEndpoint } : {}) });
}

function refusalText(batch: AppliedBatch): string {
  const refusal = batch.refused[0];
  return refusal ? `, refused ${refusal.type} — ${refusal.code}: ${refusal.message.slice(0, 160)}` : "";
}

function reportBatch(run: ScenarioRun, batch: AppliedBatch, options: RunOptions): void {
  run.fakeHostBatches = [...(run.fakeHostBatches ?? []), batch];
  if (!options.quiet) process.stdout.write(`    applied ${batch.planId}: ${batch.applied}/${batch.operations} operations${refusalText(batch)}\n`);
}

async function serveProject(context: ScenarioContext, run: ScenarioRun, snapshot: ProjectSnapshot): Promise<string | undefined> {
  const { sidecar, options, hosting } = context;
  hosting.current = run;
  if (hosting.host) hosting.host.load(snapshot);
  else hosting.host = await startFakePluginHost({
    stateDirectory: isolatedProfileDirectory(sidecar.isolatedHome), censusDirectory: sidecar.profileSource, snapshot,
    onBatch: (batch) => { if (options.fakeHost && hosting.current) reportBatch(hosting.current, batch, options); },
  });
  return untilRead(sidecar, hosting.host);
}

async function prepareProject(context: ScenarioContext, run: ScenarioRun): Promise<ProjectSnapshot | undefined> {
  const { sidecar, options, hosting } = context;
  if (options.pluginEndpoint) {
    const unread = await untilEndpointRead(sidecar);
    if (unread) run.failures.push(unread);
    return undefined;
  }
  const probe = freshProbe(compositionAsset(run.scenario.asset), `probe-${run.scenario.id}-${Date.now().toString(36)}`);
  const unread = await serveProject(context, run, fixtureSnapshotFromProbe(probe));
  if (unread) run.failures.push(unread);
  return hosting.host?.snapshot;
}

function factContext(context: ScenarioContext, initial: ProjectSnapshot | undefined): FactContext | { skipped: string } {
  if (context.options.pluginEndpoint) return { skipped: "skipped on real plugin" };
  const host = context.hosting.host;
  return context.options.fakeHost && host && initial ? { snapshot: host.snapshot, initial } : { skipped: "skipped without --fake-host" };
}

function turnFactFailures(
  run: ScenarioRun,
  context: ScenarioContext,
  turn: { index: number; initial: ProjectSnapshot | undefined; cutOff: boolean },
): string[] {
  const facts = run.scenario.facts?.[turn.index - 1] ?? [];
  if (!facts.length || turn.cutOff) return [];
  const checkable = factContext(context, turn.initial);
  if ("skipped" in checkable) {
    run.skippedChecks = [...(run.skippedChecks ?? []), `turn ${turn.index}: project facts ${checkable.skipped} (${facts.join(", ")})`];
    return [];
  }
  return factFailures(facts, checkable);
}

function isHealthy(cutOff: boolean, report: ScenarioReport): boolean {
  return !cutOff && report.status === 200 && report.outcome !== "failed";
}

async function runTurns(run: ScenarioRun, context: ScenarioContext, initial: ProjectSnapshot | undefined): Promise<TurnRecord[]> {
  const scenario = run.scenario, turns: TurnRecord[] = [];
  let history = scenario.history ?? [];
  for (const [at, message] of [scenario.message, ...(scenario.followUps ?? [])].entries()) {
    const index = at + 1;
    const turn = await runScenarioTurn(context.turnSettings, { scenarioId: scenario.id, index, message, history, host: context.hosting.host });
    const report = reportFromResponse(turn.response, turn.durationMs);
    const failures = turnFactFailures(run, context, { index, initial, cutOff: turn.cutOff });
    turns.push({
      index,
      message,
      report,
      logLines: context.sidecar.logLines.slice(turn.logStart, turn.logEnd),
      factFailures: failures,
      passed: isHealthy(turn.cutOff, report) && failures.length === 0,
    });
    if (turn.cutOff) break;
    history = [...history, { role: "user", content: message }, { role: "assistant", content: report.answer || "Done." }];
  }
  return turns;
}

async function readStore(run: ScenarioRun, sidecar: SidecarHandle, before: ReadonlySet<string>): Promise<void> {
  if (run.report?.cutOff) return;
  run.store = (await planStoreRows(sidecar)).filter((row) => !before.has(row.planId));
  run.storedOperations = await recalledOperations(sidecar, run.store.map((row) => row.planId));
}

function factVerdicts(run: ScenarioRun): string[] {
  if (run.report?.cutOff) return [];
  return (run.turns ?? []).flatMap((turn) => turn.factFailures.map((failure) => `turn ${turn.index}: ${failure}`));
}

function scenarioVerdict(run: ScenarioRun): string {
  return `${run.report?.cutOff ? "CUT " : run.failures.length ? "FAIL" : "ok  "} ${run.scenario.id}`;
}

async function runScenario(scenario: Scenario, context: ScenarioContext): Promise<ScenarioRun> {
  const { sidecar, options } = context;
  const run: ScenarioRun = { scenario, logLines: [], failures: [] };
  if (!scenario.offline && context.provider.kind === "mock") {
    run.skipped = "needs a model: the offline mock provider only understands a rename request";
    return run;
  }
  const initial = await prepareProject(context, run);
  if (run.failures.length) return run;
  const logStart = sidecar.logLines.length;
  const storeBefore = new Set((await planStoreRows(sidecar)).map((row) => row.planId));
  run.turns = await runTurns(run, context, initial);
  run.logLines = sidecar.logLines.slice(logStart);
  run.report = mergedReport(run.turns.flatMap((turn) => (turn.report ? [turn.report] : [])));
  await readStore(run, sidecar, storeBefore);
  run.failures = [...checkExpectations(run, scenario.expect), ...factVerdicts(run)];
  if (run.turns.length === 1 && run.turns[0]) run.turns[0].passed = run.failures.length === 0;
  options.afterEach?.(run, sidecar);
  if (!options.quiet) process.stdout.write(`  ${scenarioVerdict(run)}\n`);
  return run;
}

function timeoutFor(provider: ChatTestProvider, options: RunOptions): number {
  return options.timeoutMs ?? (provider.kind === "mock" ? MOCK_SCENARIO_TIMEOUT_MS : LIVE_SCENARIO_TIMEOUT_MS);
}

/** Runs the named scenarios one after another against one sidecar and returns what each did. */
export async function runScenarios(ids: readonly string[], provider: ChatTestProvider, options: RunOptions = {}): Promise<ScenarioRun[]> {
  const selected = SCENARIOS.filter((scenario) => ids.includes(scenario.id));
  const sidecar = await (options.start ?? startPlain(options))(provider);
  const hosting: Hosting = {};
  const turnSettings: TurnSettings = {
    sidecar,
    timeoutMs: timeoutFor(provider, options),
    fakeHost: options.fakeHost === true,
    pluginEndpoint: Boolean(options.pluginEndpoint),
    watch: options.watch === true,
  };
  const context: ScenarioContext = { sidecar, provider, options, turnSettings, hosting };
  const runs: ScenarioRun[] = [];
  try {
    await sidecar.patchPrefs({ askBeforeApplying: options.fakeHost || options.pluginEndpoint ? "never" : "always" });
    for (const scenario of selected) runs.push(await runScenario(scenario, context));
    return runs;
  } finally {
    await hosting.host?.stop();
    await sidecar.stop();
  }
}

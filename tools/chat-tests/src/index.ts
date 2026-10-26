/** The chat-tests package surface: scenarios, the run drivers, traces and the fake host. */
export { COMPOSITION_ASSETS, compositionAsset, freshProbe, PATHS, type AssetLayer, type AssetProperty, type CompositionAsset } from "./assets.js";
export { SCENARIOS, scenarioById, type Scenario, type ScenarioExpectation } from "./scenarios.js";
export { loadPrompts, parsePrompt, PROMPTS_DIRECTORY, type LoadedPrompt } from "./prompts.js";
export { availableProfileFiles, describeSeeding, realProfileDirectory, seedIsolatedProfile } from "./host-profile.js";
export { liveEnvironment } from "./live-environment.js";
export { REPO_ROOT } from "./repo-root.js";
export { startSidecar } from "./sidecar.js";
export type { SidecarHandle } from "./sidecar-client.js";
export type { ChatTestProvider } from "./sidecar-spawn.js";
export { startTracedSidecar, type TracedSidecarHandle } from "./inprocess.js";
export { createTrace, tracingProvider, renderTrace, extractReasoning, type Trace, type TraceBody, type TraceRecord } from "./trace.js";
export { checkExpectations, formatRun, runScenarios, targetingHaystack, type PlanCard, type RunOptions, type ScenarioRun, type ToolTrace } from "./run.js";
export { BENCHMARK_LEDGER_SCHEMA, appendLedger, ledgerRow, ledgerSummary, readLedger, repositoryRevision, type BenchmarkLedgerRow, type EvidenceMode, type LedgerContext } from "./benchmark-ledger.js";
export { BENCHMARK_CORPUS_SCHEMA, readBenchmarkProjectManifest, readExpectedStructure, type BenchmarkExpectedStructure, type BenchmarkPluginRequirement, type BenchmarkProjectManifest, type ProjectDistribution } from "./corpus.js";

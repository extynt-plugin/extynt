/** The shapes a scenario run produces: the report of a turn, the turns of a run, and the run itself. */
import type { PlanCard, ToolTrace } from "./chat-wire.js";
import type { AppliedBatch } from "./fake-plugin-host.js";
import type { Scenario } from "./scenarios.js";
import type { WireObject } from "./wire-types.js";

export type { PlanCard, ToolTrace } from "./chat-wire.js";

/** One structured line the sidecar printed. */
export type LogLine = WireObject;

/** One row of the sidecar's plan store, which is the state the turn's cards are a projection of. */
export interface PlanStoreRow { planId: string; status: string }

/** Why a turn produced no verdict about the agent. */
export type CutOff = "harness" | "provider" | "transport";

/** What one turn (or, merged, a whole scenario) reported. */
export interface ScenarioReport {
  status: number;
  outcome?: string | undefined;
  steps?: number | undefined;
  stopReason?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  answer: string;
  notes: string[];
  tools: ToolTrace[];
  plans: PlanCard[];
  usage?: WireObject | undefined;
  failure?: WireObject | undefined;
  durationMs?: number | undefined;
  cutOff?: CutOff | undefined;
}

/** One request of a scenario and what came of it. */
export interface TurnRecord {
  index: number;
  message: string;
  report: ScenarioReport | undefined;
  logLines: LogLine[];
  factFailures: string[];
  passed: boolean;
}

/** One scenario, run. */
export interface ScenarioRun {
  scenario: Scenario;
  skipped?: string;
  report?: ScenarioReport | undefined;
  store?: PlanStoreRow[];
  storedOperations?: string[];
  fakeHostBatches?: AppliedBatch[];
  logLines: LogLine[];
  turns?: TurnRecord[];
  skippedChecks?: string[];
  failures: string[];
  transcript?: string;
}

/** A run before its failures are known, which is what the expectation checks read. */
export type RunUnderCheck = Omit<ScenarioRun, "failures">;

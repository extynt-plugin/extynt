// Builders the workflow cycle tests share: a plain agent result, a cycle run seeded the way a fresh workflow starts, and the facts of a rig's jobs.
import { MockProvider } from "@extynt/llm";
import type { AgentRunResult } from "../src/agent.js";
import type { Rig } from "./single-loop-rig.js";
import { CycleRun, initialCycleState } from "../src/server-workflow-cycle-state.js";

/** An answered agent result with no work done, with any of its fields replaced. */
export function agentResult(fields: Partial<AgentRunResult> = {}): AgentRunResult {
  return { outcome: "answered", notes: [], answer: "", plans: [], tools: [], reasoning: [], steps: 0, steering: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0 }, ...fields };
}

/** A run that follows the job and has produced nothing yet. */
export function freshRun(jobId: string | null): CycleRun {
  return new CycleRun(initialCycleState({ used: new MockProvider(), jobId, continuation: null, orchestration: undefined, feedback: undefined }));
}

/** The value, or a failure naming what was missing; stands in for a non-null assertion when a lookup may return null or undefined. */
export function required<T>(value: T | null | undefined, what = "value"): T {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
}

/** The jobs as the workflow store holds them: their statuses, how many observations were recorded and the kinds of host evidence. */
export function jobFacts(rig: Rig): { statuses: string[]; observations: number; hostKinds: string[] } {
  const state = rig.sidecar.workflowCoordinator.workflowStore.getState();
  return { statuses: Object.values(state.jobs).map((job) => job.status), observations: Object.keys(state.observations).length, hostKinds: Object.values(state.hostEvidence).map((row) => row.kind) };
}

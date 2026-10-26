// The sidecar's pipeline log: one JSON line per event on stdout and in the profile's pipeline.log, plus the per-turn model token accounting.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { profileDirectory } from "./profile-store.js";
import type { JsonValue } from "@extynt/decode";
import { SIDECAR_BUILD_ID } from "./server-build.js";
import type { SidecarState } from "./server-state.js";
import { usageDelta, usageHasSpend, usageIsMonotonic, type StepUsage } from "./server-step-usage.js";

/** The fields one log line carries beside its time, event name and build. */
export type LogFields = { readonly [field: string]: JsonValue | undefined };

/** Writes pipeline events and per-step usage. */
export interface PlanLogCapability {
  logPlanEvent(event: string, fields: LogFields): void;
  logStepUsage(requestId: string, step: number, usage: StepUsage): void;
}

type PlanLogDeps = {
  readonly state: Pick<SidecarState, "now" | "options" | "chatStepUsage">;
};

const pipelineLogFiles = new WeakMap<PlanLogDeps["state"], string>();

function appendPipelineLine(state: PlanLogDeps["state"], serialized: string): void {
  const directory = state.options.stateDirectory ?? profileDirectory();
  const file = join(directory, "pipeline.log");
  mkdirSync(directory, { recursive: true });
  if (pipelineLogFiles.get(state) !== file) {
    writeFileSync(file, serialized, { mode: 0o600 });
    pipelineLogFiles.set(state, file);
  } else appendFileSync(file, serialized, { mode: 0o600 });
}

/** The pipeline log and step-usage accounting over the sidecar state. */
export function createPlanLog(deps: PlanLogDeps): PlanLogCapability {
  const state = deps.state;
  return {
    logPlanEvent(event: string, fields: LogFields): void {
      const line = { at: state.now().toISOString(), event, build: SIDECAR_BUILD_ID, ...fields };
      if (!state.options.quietAgentLog) process.stdout.write(`${JSON.stringify(line)}\n`);
      try { appendPipelineLine(state, `${JSON.stringify(line)}\n`); } catch { return; }
    },

    logStepUsage(requestId: string, step: number, usage: StepUsage): void {
      const previous = state.chatStepUsage?.requestId === requestId && usageIsMonotonic(state.chatStepUsage, usage) ? state.chatStepUsage : undefined;
      const delta = usageDelta(previous, usage);
      state.chatStepUsage = { requestId, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cachedInputTokens: usage.cachedInputTokens };
      if (!usageHasSpend(delta)) return;
      if (!state.options.quietAgentLog) process.stdout.write(`${JSON.stringify({ at: state.now().toISOString(), event: "agent.step", requestId, step, ...delta })}\n`);
    },
  };
}

// The progress line a continuation shows in the panel while it waits for a batch to settle, and the note it leaves when it ends.
import type { WorkflowId } from "@extynt/workflow";

import { safeWorkflowDiagnostic } from "./workflow-coordinator.js";
import type { WorkflowContinuationRun } from "./server-types.js";
import type { SidecarState } from "./server-state.js";

/** Writes the panel's progress line for a continuation run. */
export interface WorkflowProgressCapability {
  setWorkflowTerminalProgress(run: WorkflowContinuationRun, phase: "completed" | "blocked", label: string): void;
  setWorkflowWaitingProgress(requestId: string, pendingBatchId: WorkflowId, label?: string): void;
}

type WorkflowProgressDeps = {
  readonly state: Pick<SidecarState, "chatProgress" | "now" | "options" | "workflowRuns">;
};

const RETAINED_PROGRESS_ROWS = 64;
const RETAINED_NOTES = 11;
const DEFAULT_MAX_STEPS = 60;

function maxStepsOf(state: WorkflowProgressDeps["state"]): number {
  return state.options.maxAgentSteps ?? DEFAULT_MAX_STEPS;
}

function dropOldestProgress(state: WorkflowProgressDeps["state"]): void {
  while (state.chatProgress.size > RETAINED_PROGRESS_ROWS) {
    const oldest = state.chatProgress.keys().next().value;
    if (typeof oldest !== "string") return;
    state.chatProgress.delete(oldest);
  }
}

function dropOldestTerminalRuns(state: WorkflowProgressDeps["state"]): void {
  while (state.workflowRuns.size > RETAINED_PROGRESS_ROWS) {
    const oldest = state.workflowRuns.entries().next().value;
    if (!oldest || oldest[1].state !== "terminal") return;
    state.workflowRuns.delete(oldest[0]);
  }
}

/** Builds the progress writer over the sidecar's chat progress rows and workflow runs. */
export function createWorkflowProgress(deps: WorkflowProgressDeps): WorkflowProgressCapability {
  const state = deps.state;
  return {
    setWorkflowWaitingProgress(requestId, pendingBatchId, customLabel) {
      const prior = state.chatProgress.get(requestId);
      const label = customLabel ?? `Workflow waiting for batch ${safeWorkflowDiagnostic(pendingBatchId)} to settle; executed work that still needs visual proof continues through a read-only validation cycle.`;
      state.chatProgress.set(requestId, {
        requestId,
        step: prior?.step ?? 0,
        maxSteps: maxStepsOf(state),
        phase: "note",
        label,
        notes: [...(prior?.notes ?? []).slice(-RETAINED_NOTES), label],
        at: state.now().toISOString(),
        ...(prior?.authoring ? { authoring: prior.authoring } : {}),
      });
    },

    setWorkflowTerminalProgress(run, phase, label) {
      const safeLabel = safeWorkflowDiagnostic(label);
      state.chatProgress.set(run.requestId, { requestId: run.requestId, step: state.chatProgress.get(run.requestId)?.step ?? 0, maxSteps: maxStepsOf(state), phase: "note", label: `Workflow ${phase}: ${safeLabel}`, notes: [safeLabel], at: state.now().toISOString() });
      dropOldestProgress(state);
      dropOldestTerminalRuns(state);
    },
  };
}

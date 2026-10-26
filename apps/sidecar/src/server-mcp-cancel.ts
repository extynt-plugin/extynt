// Cancelling a plan that a workflow is running: the chat turn that seeded it is aborted with it.
import { decodeOrThrow } from "@extynt/decode";
import type { McpInput } from "./server-mcp-arguments.js";
import type { McpToolsDeps } from "./server-mcp-model.js";
import type { WorkflowCoordinator } from "./workflow-coordinator.js";
import { DIVERGENCE_FAILURE, type ThrownFailure } from "./workflow-coordinator-types.js";

type WorkflowFault = ThrownFailure;

function cancelRun(deps: McpToolsDeps, coordinator: WorkflowCoordinator, planId: string): void {
  const jobId = coordinator.jobIdForPlan(planId);
  if (!jobId) return;
  const turn = deps.state.activeChatTurn;
  if (turn && coordinator.jobIdForSeed(turn.requestId) === jobId) turn.controller.abort(new Error("workflow plan cancelled"));
  deps.cycles.cancelWorkflowJob(jobId);
  deps.continuation.onWorkflowSettlement(planId);
}

function refuseCancel(deps: McpToolsDeps, coordinator: WorkflowCoordinator, refused: { planId: string; error: WorkflowFault }): void {
  const { planId, error } = refused;
  coordinator.markDivergence(planId, error);
  deps.planLog.logPlanEvent("plan.workflow-cancel-refused", { planId, message: error instanceof Error ? error.message : String(error) });
}

/** Stops the workflow job behind a cancelled plan and its chat turn; a plan cancelled from elsewhere has no job to stop, and a refusal by the workflow is recorded, never raised. */
export function cancelWorkflowTool(deps: McpToolsDeps, input: McpInput): void {
  const { planId } = input.controls;
  const coordinator = deps.state.workflowCoordinator;
  if (!planId || !coordinator.hasPlan(planId)) return;
  try {
    cancelRun(deps, coordinator, planId);
  } catch (error) {
    refuseCancel(deps, coordinator, { planId, error: decodeOrThrow(DIVERGENCE_FAILURE, error) });
  }
}

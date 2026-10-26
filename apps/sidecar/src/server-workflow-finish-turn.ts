// Turn-end rules for an owner turn of an admitted job: who may complete, when a job is settled, and closing a turn that already built the whole request.
import { ENDED_IN_PROSE, type TurnEnd } from "@extynt/decide";
import type { WorkflowId } from "@extynt/workflow";
import type { AgentRunResult } from "./agent.js";
import type { AgentCallState, ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import { jobCoverageRefusal, primeJobCoverage } from "./server-workflow-auto-complete.js";
import { ownCompletionWithFrames, type RunTool } from "./server-workflow-completion-evidence.js";
import { WORKFLOW_OWNER } from "./workflow-orchestration.js";

const CLOSED_STATUSES: ReadonlySet<string> = new Set(["completed", "blocked", "cancelled"]);

/** A live owner turn of an admitted job: only the owner may complete, and a discovery or cancelled turn never does. */
export function ownerTurn(input: ChatAgentInput): input is ChatAgentInput & { workflowJobId: string } {
  return input.workflowRole === WORKFLOW_OWNER && !!input.workflowJobId && !input.discoveryOnly && !input.signal?.aborted;
}

function ownerTurnOpen(input: ChatAgentInput, callState: AgentCallState): input is ChatAgentInput & { workflowJobId: string } {
  return ownerTurn(input) && !callState.workflowCompletion;
}

function turnEnd(result: AgentRunResult): TurnEnd {
  return { answer: result.answer, sealed: result.sealed === true, failed: !!result.failure, askedUser: !!result.askedUser, refused: !!result.workflowAdmissionRefusal };
}

/** An open job whose every batch has settled: what the model built has all landed, so there is nothing left to wait for. */
export function settledJob(deps: { state: Pick<ChatAgentDeps["state"], "workflowCoordinator"> }, jobId: WorkflowId): boolean {
  const state = deps.state.workflowCoordinator.workflowStore.getState();
  const job = state.jobs[jobId];
  if (!job || CLOSED_STATUSES.has(job.status) || !job.batchIds.length) return false;
  return job.batchIds.every((batchId) => state.batches[batchId]?.lifecycle === "settled");
}

/**
 * A turn that built the whole request and reported it done closes here, with the frames the sidecar takes itself,
 * instead of in a second provider cycle that re-reads the project only to prove it. The engine still checks every
 * criterion against evidence bound to the current project; a job it refuses carries on exactly as before.
 * Free run never does this: prose is no completion signal there, so the job goes back to the model instead.
 */
export async function completeFinishedTurn(deps: ChatAgentDeps, input: ChatAgentInput, turn: { readonly callState: AgentCallState; readonly result: AgentRunResult }, run: RunTool): Promise<void> {
  const { callState, result } = turn;
  if (deps.state.options.workflowFreeRun === true || !ownerTurnOpen(input, callState)) return;
  if (!(await deps.state.decisions.settleBinary(ENDED_IN_PROSE, turnEnd(result), { moment: "completion", jobId: input.workflowJobId }))) return;
  const jobId = deps.state.workflowCoordinator.jobIdForSeed(input.workflowJobId);
  if (!settledJob(deps, jobId)) return;
  await primeJobCoverage(deps, jobId);
  if (jobCoverageRefusal(deps, jobId)) return;
  if ((await ownCompletionWithFrames(deps, jobId, run)).ok) callState.workflowCompletion = { accepted: true };
}

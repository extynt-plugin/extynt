// `ae_propose_plan { apply: true }`: the proposal and its approval answered as one result, through the same approval path an `ae_approve_plan` call takes.
import { mcpInputOf } from "./server-mcp-arguments.js";
import { approveInputFor, foldApproval, isProposeApply, type ApprovalRefusal } from "./server-mcp-apply.js";
import { finishApproval } from "./server-mcp-approval.js";
import { planIdOf } from "./server-mcp-data.js";
import { refreshFingerprint } from "./server-mcp-decorate.js";
import { executeTool } from "./server-mcp-execute.js";
import type { McpRun } from "./server-mcp-finish.js";
import type { McpToolsDeps } from "./server-mcp-model.js";

const STALE_CODES: ReadonlySet<string> = new Set(["STALE_SNAPSHOT", "STALE_SELECTION"]);

function withdrawStale(deps: McpToolsDeps, run: McpRun, planId: string): boolean {
  const withdrawn = executeTool(deps, mcpInputOf("ae_cancel_plan", { planId }), { snapshot: run.snapshot, agentOriginated: run.call.agentOriginated });
  return withdrawn.ok;
}

/** Approves a proposal the caller asked to apply in the same call and answers with the outcome folded into it; false when the call is not a propose+apply or the proposal was not made. */
export async function applyProposal(deps: McpToolsDeps, run: McpRun): Promise<boolean> {
  const { call, snapshot, result: proposal } = run;
  if (!isProposeApply(call.input) || !proposal.ok || !snapshot) return false;
  const planId = planIdOf(proposal.data);
  const approveInput = approveInputFor(call.input, planId);
  const approvalSnapshot = deps.planState.normalizedLatest() ?? snapshot;
  const statusBeforeApprove = deps.state.plans.get(planId)?.status;
  const approved = executeTool(deps, approveInput, { snapshot: approvalSnapshot, agentOriginated: call.agentOriginated });
  const refuse = (refusal: ApprovalRefusal): void => {
    const cancelled = STALE_CODES.has(refusal.code) && withdrawStale(deps, run, planId);
    foldApproval(proposal, { refusal, cancelled });
    call.answer(proposal);
  };
  if (!approved.ok) {
    refuse(approved.error);
    return true;
  }
  const finish = { result: approved, normalized: approvalSnapshot, planId, statusBeforeApprove, agentOriginated: call.agentOriginated, waitSeconds: call.waitSeconds, exchange: call.exchange, onRefusal: refuse };
  if (await finishApproval(deps, finish)) return true;
  refreshFingerprint(deps, approveInput, approved);
  foldApproval(proposal, { approved });
  call.answer(proposal);
  return true;
}

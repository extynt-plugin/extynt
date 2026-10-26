// `ae_propose_plan { apply: true }`: the proposal and its approval answered as one result.
import { mcpInputOf, type McpInput } from "./server-mcp-arguments.js";
import { isDataFields, type DataFields } from "./server-mcp-data.js";
import type { McpSuccess } from "./server-mcp-result.js";

const CARRIED_KEYS = ["planId", "status", "mailbox", "queuePosition", "rebased", "pipeline", "waitedSeconds", "note", "receipt", "frame"] as const;

/** Why an approval folded into a proposal was refused. */
export interface ApprovalRefusal {
  readonly code: string;
  readonly message: string;
}

/** True when the caller asked for the proposal to be approved in the same call. */
export function isProposeApply(input: McpInput): boolean {
  return input.name === "ae_propose_plan" && input.controls.apply;
}

/** The approve call a propose+apply stands for; the acknowledgement is the caller's own, never assumed. */
export function approveInputFor(input: McpInput, planId: string): McpInput {
  const waitSeconds = input.arguments.waitSeconds;
  return mcpInputOf("ae_approve_plan", { planId, acknowledgeUnverified: input.controls.acknowledgeUnverified, ...(waitSeconds === undefined ? {} : { waitSeconds }) });
}

function approvalFields(data: DataFields): DataFields {
  const picked: DataFields = {};
  for (const key of CARRIED_KEYS) {
    const carried = data[key];
    if (carried !== undefined) picked[key] = carried;
  }
  const approval = data.approval;
  const expiresAt = isDataFields(approval) ? approval.expiresAt : undefined;
  if (expiresAt) picked.approval = { expiresAt };
  return picked;
}

/** Puts the approval outcome on the proposal's own data; a refused approval applied nothing and leaves the proposal standing, unless the refusal was staleness, which withdraws it. */
export function foldApproval(proposal: McpSuccess, outcome: { approved: McpSuccess } | { refusal: ApprovalRefusal; cancelled?: boolean }): void {
  const data = proposal.data;
  if (!isDataFields(data)) return;
  if ("refusal" in outcome) {
    data.apply = { approved: false, refusal: { code: outcome.refusal.code, message: outcome.refusal.message }, ...(outcome.cancelled ? { cancelled: true } : {}) };
    if (outcome.cancelled) data.status = "cancelled";
    return;
  }
  const approved = isDataFields(outcome.approved.data) ? approvalFields(outcome.approved.data) : {};
  data.apply = { approved: true, ...approved };
  const status = approved.status;
  if (status === undefined) delete data.status;
  else data.status = status;
  if (typeof outcome.approved.snapshotFingerprint === "string") proposal.snapshotFingerprint = outcome.approved.snapshotFingerprint;
}

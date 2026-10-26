// Approving a plan, from a tool call or from inside the sidecar: binding the approval to a command for the paired panel, queuing it and, when the caller waits, reporting how it went.
import { callTool, jsonOf, receiptJson, type StoredPlan } from "@extynt/mcp-server";
import type { ProjectSnapshot } from "@extynt/project-graph";

import type { PlanSource } from "./host/facts.js";
import { publishPlans } from "./plans-events.js";
import type { ApprovalRefusal } from "./server-mcp-apply.js";
import { attachFrame } from "./server-mcp-approval-frame.js";
import { addFields, isDataFields, type DataFields } from "./server-mcp-data.js";
import { FRAME_SKIPPED_TIMEOUT, isAppliedStatus } from "./server-mcp-frame.js";
import { refuseCall, type McpExchange, type McpToolsDeps } from "./server-mcp-model.js";
import type { McpSuccess } from "./server-mcp-result.js";

/** How an approval from inside the sidecar went. */
export type InProcessApproval = { readonly ok: true } | ({ readonly ok: false } & ApprovalRefusal);

interface ApprovalAttachment {
  readonly result: McpSuccess;
  readonly normalized: ProjectSnapshot;
  readonly planId: string;
  readonly statusBeforeApprove: StoredPlan["status"] | undefined;
  readonly source: PlanSource;
  readonly requestId?: string | null;
}

interface ApprovalFinish {
  readonly result: McpSuccess;
  readonly normalized: ProjectSnapshot;
  readonly planId: string;
  readonly statusBeforeApprove: StoredPlan["status"] | undefined;
  readonly agentOriginated: boolean;
  readonly waitSeconds: number;
  readonly exchange: McpExchange;
  readonly onRefusal?: (refusal: ApprovalRefusal) => void;
}

function isApproving(status: StoredPlan["status"] | undefined): boolean {
  return status === "approved" || status === "applying";
}

function restoreApprovalRecord(deps: McpToolsDeps, record: StoredPlan | undefined, restore: { status: StoredPlan["status"] | undefined; planId: string; code: string }): void {
  if (!record) return;
  record.status = restore.status ?? "prepared";
  record.updatedAt = deps.state.now().toISOString();
  deps.planLog.logPlanEvent("plan.approve-refused", { planId: restore.planId, code: restore.code });
}

function attachApproval(deps: McpToolsDeps, attachment: ApprovalAttachment): ApprovalRefusal | undefined {
  const { result, normalized, planId, statusBeforeApprove, source, requestId } = attachment;
  const record = deps.state.plans.get(planId);
  if (!record) return undefined;
  deps.state.hostFacts.capturePlan?.(planId, "before", "ahead");
  const attached = deps.delivery.attachMailboxCommand(result, record, normalized);
  if ("code" in attached) {
    restoreApprovalRecord(deps, record, { status: statusBeforeApprove, planId, code: attached.code });
    return { code: attached.code, message: attached.message };
  }
  deps.planLog.logPlanEvent("plan.approved", { planId, requestId: requestId ?? deps.planView.sealingTurn(planId), status: record.status, agentOriginated: source === "agent" });
  deps.state.hostFacts.planSources.set(planId, source);
  return undefined;
}

async function pictureApproval(deps: McpToolsDeps, finish: ApprovalFinish, settled: { current: StoredPlan | undefined; data: DataFields }): Promise<void> {
  const { current, data } = settled;
  if (current && finish.agentOriginated && isAppliedStatus(current.status)) await attachFrame(deps, current, { data, normalized: finish.normalized });
}

function settleApprovalFields(deps: McpToolsDeps, planId: string, data: DataFields): StoredPlan | undefined {
  const current = deps.state.plans.get(planId);
  if (!current) return undefined;
  data.status = current.status;
  const receipt = receiptJson(current.receipt);
  if (receipt) data.receipt = receipt;
  return current;
}

async function waitForApproval(deps: McpToolsDeps, finish: ApprovalFinish): Promise<void> {
  const { planId, waitSeconds } = finish;
  const data = finish.result.data;
  if (waitSeconds <= 0 || !planId || !isDataFields(data)) return;
  const settled = await deps.transport.waitUntil(() => !isApproving(deps.state.plans.get(planId)?.status), waitSeconds);
  const current = settleApprovalFields(deps, planId, data);
  if (settled) {
    await pictureApproval(deps, finish, { current, data });
    return;
  }
  data.frame = jsonOf(FRAME_SKIPPED_TIMEOUT);
  const queuePosition = deps.planView.planQueuePosition(planId);
  addFields(finish.result, { waitedSeconds: waitSeconds, note: "Not finished yet; call ae_get_plan_status (it waits for the next change).", pipeline: deps.planView.pipeline(), ...(queuePosition ? { queuePosition } : {}) });
}

/** Attaches the approval and, unless it is refused (and answered), waits as long as the caller allows for it to apply; true when the call has been answered. The panel's own Apply waits like an agent's call: its result carries the status and the receipt. */
export async function finishApproval(deps: McpToolsDeps, finish: ApprovalFinish): Promise<boolean> {
  const { result, normalized, planId, statusBeforeApprove, agentOriginated, exchange, onRefusal } = finish;
  const source = agentOriginated ? "agent" : "panel";
  const refusal = attachApproval(deps, { result, normalized, planId, statusBeforeApprove, source, requestId: exchange.context.requestId });
  if (refusal && onRefusal) {
    onRefusal(refusal);
    return true;
  }
  if (refusal) {
    refuseCall(deps.transport, exchange, { status: 422, ...refusal });
    return true;
  }
  await waitForApproval(deps, finish);
  return false;
}

/** Approves a plan from inside the sidecar (the host lane's auto-approval, a UI Apply): same tool, same binding, the command queued for the lane. */
export async function approvePlanInProcess(deps: McpToolsDeps, planId: string, source: PlanSource): Promise<InProcessApproval> {
  const normalized = deps.planState.normalizedLatest();
  if (!normalized) return { ok: false, code: "NO_SNAPSHOT", message: "Inspect a project before approving a plan." };
  const statusBeforeApprove = deps.state.plans.get(planId)?.status;
  const result = callTool("ae_approve_plan", { planId, acknowledgeUnverified: true }, deps.planView.toolContext(normalized, "panel"));
  if (!result.ok) return { ok: false, code: result.error.code, message: result.error.message };
  const refusal = attachApproval(deps, { result, normalized, planId, statusBeforeApprove, source });
  deps.transport.notifyChange();
  publishPlans(deps.state, "approved", planId);
  deps.runtime.prunePlans();
  return refusal ? { ok: false, ...refusal } : { ok: true };
}

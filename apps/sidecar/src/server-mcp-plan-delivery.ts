// A plan's undo and its sealed card: the undo queued for the paired panel and the workflow, the card put beside the sealing result.
import { array, decodeOrThrow, fallback, type Infer, nullable, number, object, string } from "@extynt/decode";
import { jsonOf, receiptJson, statusFromApplyReceipt, type StoredPlan } from "@extynt/mcp-server";

import { undoReadsFor } from "./apply-read-spec.js";
import { enqueueHostWork } from "./host/work-queue.js";
import { lenientObject } from "./server-mcp-arguments.js";
import { isDataFields, type DataFields } from "./server-mcp-data.js";
import type { McpDeliveryDeps } from "./server-mcp-delivery-deps.js";
import type { McpSuccess } from "./server-mcp-result.js";
import { DIVERGENCE_FAILURE, type ThrownFailure } from "./workflow-coordinator-types.js";

/** The tools whose success is only a request to undo until the panel is handed it. */
export const UNDO_TOOLS: ReadonlySet<string> = new Set(["ae_undo_plan", "ae_undo_agent_work"]);

const undoStep = object({ planId: string(), times: number(), groups: number(), undoGroup: string(), expectedFingerprint: nullable(string()) });

const undoRequest = lenientObject({
  planId: fallback(string(), undefined),
  undoGroup: fallback(string(), undefined),
  times: fallback(number(), undefined),
  scope: fallback(string(), undefined),
  expectedFingerprint: fallback(string(), undefined),
  jobUndo: fallback(lenientObject({ jobId: fallback(string(), undefined), order: fallback(array(fallback(undoStep, undefined)), undefined) }), undefined),
});

type UndoRequest = Infer<typeof undoRequest>;
type WorkflowFault = ThrownFailure;

interface PriorUndoState {
  readonly status: StoredPlan["status"];
  readonly updatedAt: string;
  readonly undoReceipt: StoredPlan["undoReceipt"];
}

/** The plan-level members of the delivery capability: the sealed card is built from the plan store, the only place that holds it, because the model never sees the plan id. */
export interface PlanDeliveryCapability {
  attachSealedCard(result: McpSuccess, planId: string | null): void;
  deliverUndo(result: McpSuccess, waitSeconds: number): Promise<void>;
}

function statusBeforeUndo(record: StoredPlan): StoredPlan["status"] {
  if (record.status !== "undo_requested") return record.status;
  return record.undoReceipt ? "partially_undone" : statusFromApplyReceipt(record.receipt);
}

function priorStateOf(record: StoredPlan | undefined): PriorUndoState | undefined {
  return record ? { status: statusBeforeUndo(record), updatedAt: record.updatedAt, undoReceipt: record.undoReceipt } : undefined;
}

function expectedFingerprintOf(undo: UndoRequest, record: StoredPlan | undefined) {
  return undo.expectedFingerprint ?? record?.receipt?.afterFingerprint ?? null;
}

function undoItem(undo: UndoRequest, planId: string, record: StoredPlan | undefined) {
  return {
    kind: "undo_plan",
    scopedUndoUnsupported: !!record?.approvalCapability?.readSetDigest,
    planId,
    ...(undo.undoGroup === undefined ? {} : { undoGroup: undo.undoGroup }),
    times: undo.times ?? 1,
    scope: undo.scope ?? "all",
    expectedFingerprint: expectedFingerprintOf(undo, record),
  };
}

function restoreRefusedUndo(record: StoredPlan | undefined, prior: PriorUndoState | undefined): void {
  if (!record || !prior) return;
  record.status = prior.status;
  record.updatedAt = prior.updatedAt;
  if (prior.undoReceipt) record.undoReceipt = prior.undoReceipt;
  else delete record.undoReceipt;
}

function queueUndo(deps: McpDeliveryDeps, undo: UndoRequest, planId: string, record: StoredPlan | undefined): void {
  const { state } = deps;
  const reads = undoReadsFor(state, jsonOf(record?.plan.operations));
  enqueueHostWork(state, { approvedData: { ...undoItem(undo, planId, record), restoreFingerprint: record ? record.plan.snapshotFingerprint : null, reads: jsonOf(reads) } });
  const order = (undo.jobUndo?.order ?? []).flatMap((step) => (step ? [step] : []));
  const jobId = undo.jobUndo?.jobId;
  state.pendingJobUndo = jobId && order.length > 1 ? { jobId, order, cursor: 1 } : null;
}

function refuseWorkflowUndo(deps: McpDeliveryDeps, input: { planId: string; error: WorkflowFault; data: DataFields; record: StoredPlan | undefined; prior: PriorUndoState | undefined }): void {
  const { planId, error, data, record, prior } = input;
  deps.state.workflowCoordinator.markDivergence(planId, error);
  deps.planLog.logPlanEvent("plan.workflow-undo-refused", { planId, message: error instanceof Error ? error.message : String(error) });
  restoreRefusedUndo(record, prior);
  if (prior) data.status = prior.status;
  data.workflowRefused = true;
}

function workflowAcceptsUndo(deps: McpDeliveryDeps, input: { planId: string; undo: UndoRequest; data: DataFields; record: StoredPlan | undefined; prior: PriorUndoState | undefined }): boolean {
  const { planId, undo, data, record, prior } = input;
  const coordinator = deps.state.workflowCoordinator;
  if (!planId || !coordinator.hasPlan(planId) || undo.expectedFingerprint === undefined) return true;
  try {
    coordinator.requestUndo(planId, undo.expectedFingerprint);
    return true;
  } catch (error) {
    refuseWorkflowUndo(deps, { planId, error: decodeOrThrow(DIVERGENCE_FAILURE, error), data, record, prior });
    return false;
  }
}

function settleUndoFields(deps: McpDeliveryDeps, planId: string, data: DataFields): StoredPlan | undefined {
  const current = deps.state.plans.get(planId);
  const status = current?.status ?? data.status;
  if (status !== undefined) data.status = status;
  const receipt = receiptJson(current?.undoReceipt);
  if (receipt) data.receipt = receipt;
  return current;
}

async function waitForUndo(deps: McpDeliveryDeps, wait: { planId: string; data: DataFields; waitSeconds: number }): Promise<void> {
  const { planId, data, waitSeconds } = wait;
  if (waitSeconds <= 0) return;
  await deps.transport.waitUntil(() => deps.state.plans.get(planId)?.status !== "undo_requested", waitSeconds);
  const current = settleUndoFields(deps, planId, data);
  if (current?.status === "undo_requested") Object.assign(data, { waitedSeconds: waitSeconds, note: "Undo still queued.", pipeline: deps.planView.pipeline() });
}

/** The delivery of plan-level work: undo and the sealed card. */
export function createPlanDelivery(deps: McpDeliveryDeps): PlanDeliveryCapability {
  return {
    attachSealedCard(result: McpSuccess, planId: string | null): void {
      const record = planId ? deps.state.plans.get(planId) : undefined;
      if (!planId || !record) return;
      result.sealedCard = { planId, presentation: record.presentation ?? null, plan: record.plan, summary: record.plan.summary };
    },

    async deliverUndo(result: McpSuccess, waitSeconds: number): Promise<void> {
      const data = result.data;
      if (!isDataFields(data)) return;
      const undo = decodeOrThrow(undoRequest, data);
      const planId = result.undoPlanId ?? undo.planId ?? "";
      const record = deps.state.plans.get(planId);
      const prior = priorStateOf(record);
      if (!workflowAcceptsUndo(deps, { planId, undo, data, record, prior })) return;
      queueUndo(deps, undo, planId, record);
      await waitForUndo(deps, { planId, data, waitSeconds });
    },
  };
}

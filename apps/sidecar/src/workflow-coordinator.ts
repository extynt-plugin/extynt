// The sidecar's effectful adapter over the pure workflow model: admits sealed plans, records receipts and undo receipts, and projects the state.

import { decodeOrThrow } from "@extynt/decode";
import type { StoredPlan, StoredReceipt } from "@extynt/mcp-server";
import { computePlanDigest, type ActionPlan } from "@extynt/action-plan";
import type { WorkflowBatch, WorkflowContinuationInput, WorkflowEvent, WorkflowId, WorkflowReceipt, WorkflowUndoReceipt } from "@extynt/workflow";
import {
  mutationBehaviorForPlan, admissionPreflight, admissionIdentity, admissionEvents,
  type AdmissionResult, type WorkflowAdmissionOptions
} from "./workflow-coordinator-admission.js";
import { buildProjection, type ProjectedDivergence, type WorkflowProjection } from "./workflow-coordinator-projection.js";
import {
  acceptsLateExecutionReceipt, acceptsLateReceiptReconciliation, acceptsLateUndoReconciliation, approvalConflict, unprovedAppliedBatch
} from "./workflow-coordinator-queries.js";
import { WorkflowJobController } from "./workflow-coordinator-jobs.js";
import { recoverWorkflowPlans } from "./workflow-coordinator-recovery.js";
import { workflowReceipt, workflowUndoReceipt } from "./workflow-coordinator-receipts.js";
import { eventId, iso, safeWorkflowDiagnostic, thrownFailure, type ThrownFailure, type WorkflowCoordinatorOptions, type WorkflowPlanRecord } from "./workflow-coordinator-types.js";
import type { EvidenceContext } from "./workflow-proportional-evidence.js";

type BatchTransition = "batch.queued" | "batch.claimed" | "batch.executing" | "batch.cancelRequested";
type UndoTransition = "batch.undoClaimed" | "batch.undoExecuting";
type DesignContext = (jobId: WorkflowId) => { readonly designed: boolean; readonly motion: boolean };
type ApprovalClaim = { readonly approvalId: string; readonly snapshotFingerprint: string; readonly sourcePlanDigest: string };

function assertApplyable(planId: string, batch: WorkflowBatch, sealedFingerprint: string, claim: ApprovalClaim): void {
  if (batch.lifecycle === "claimed" || batch.lifecycle === "executing") throw Object.assign(new Error(`Workflow plan ${planId} already owns a host dispatch attempt.`), { code: "DUPLICATE_DISPATCH" });
  if (claim.snapshotFingerprint !== sealedFingerprint) throw Object.assign(new Error("The current project snapshot no longer matches the sealed workflow batch."), { code: "STALE_SNAPSHOT" });
  if (approvalConflict(batch, claim)) throw new Error(`Workflow plan ${planId} has a different approval binding.`);
}

const SETTLED_LIFECYCLES: readonly WorkflowBatch["lifecycle"][] = ["settled", "cancelled"];

/** Admits sealed plans as workflow batches and records every host receipt against them. */
export class WorkflowCoordinator extends WorkflowJobController {
  public readonly engine = "workflow-v1" as const;
  private readonly plans = new Map<string, WorkflowPlanRecord>();
  private readonly divergences = new Map<string, ProjectedDivergence>();
  private readonly notices: string[] = [];
  private readonly closeCallbacks: Array<() => void> = [];
  private designContext: DesignContext | undefined;

  public constructor(options: WorkflowCoordinatorOptions = {}) {
    super(options);
    for (const recovered of recoverWorkflowPlans(this.store.getState())) this.plans.set(recovered.coordinator.planId, recovered.coordinator);
  }

  public bindDesignContext(read: DesignContext): void { this.designContext = read; }

  public recoveredPlans(): readonly StoredPlan[] {
    return recoverWorkflowPlans(this.store.getState()).map((record) => record.stored);
  }

  public close(): readonly string[] {
    const failures: string[] = [];
    for (const callback of this.closeCallbacks.splice(0)) {
      try { callback(); } catch (caught) { failures.push(decodeOrThrow(thrownFailure("CLOSE_CALLBACK_FAILED"), caught).message); }
    }
    this.store.close();
    return failures;
  }

  public hasPlan(planId: string): boolean { return this.plans.has(planId); }

  public jobIdForPlan(planId: string): WorkflowId | null { return this.plans.get(planId)?.jobId ?? null; }

  public batchIdForPlan(planId: string): WorkflowId | null { return this.plans.get(planId)?.batchId ?? null; }

  public batchForPlan(planId: string): WorkflowBatch | null {
    const batchId = this.batchIdForPlan(planId);
    return batchId ? this.store.getState().batches[batchId] ?? null : null;
  }

  public canReconcileLateReceipt(planId: string): boolean { return acceptsLateReceiptReconciliation(this.batchForPlan(planId)); }

  public canAcceptLateExecutionReceipt(planId: string): boolean { return acceptsLateExecutionReceipt(this.batchForPlan(planId)); }

  public canReconcileLateUndo(planId: string): boolean { return acceptsLateUndoReconciliation(this.batchForPlan(planId)); }

  public unprovedAppliedBatch(jobId: WorkflowId): WorkflowBatch | undefined { return unprovedAppliedBatch(this.store.getState(), jobId); }

  public get startupNotices(): readonly string[] { return this.notices; }

  public addStartupNotice(notice: string): void { if (this.notices.length < 8) this.notices.push(safeWorkflowDiagnostic(notice).slice(0, 400)); }

  public onClose(callback: () => void): void { this.closeCallbacks.push(callback); }

  public markDivergence(planId: string, failure: ThrownFailure): void {
    this.requirePlan(planId);
    this.divergences.set(planId, { planId, code: failure.code.slice(0, 64), message: safeWorkflowDiagnostic(failure.message), at: iso(this.now) });
  }

  public admitPlan(plan: ActionPlan, options: WorkflowAdmissionOptions): AdmissionResult {
    const preflight = admissionPreflight(plan, options, this.plans.get(plan.planId));
    if (preflight) return preflight;
    const context = admissionIdentity(this.store.getState(), plan, options, iso(this.now));
    try {
      this.store.appendBatch([...admissionEvents(context)]);
    } catch (caught) {
      return { ok: false, ...decodeOrThrow(thrownFailure("WORKFLOW_ADMISSION_FAILED"), caught) };
    }
    this.plans.set(plan.planId, { planId: plan.planId, jobId: context.jobId, stageId: context.stageId, batchId: context.batchId, plan, receiptSequence: 0, undoSequence: 0 });
    return { ok: true, batchId: context.batchId, jobId: context.jobId, ...this.clearSupersededFailure(context.jobId) };
  }

  public queue(planId: string): void { this.transition("batch.queued", this.requirePlan(planId)); }

  public bindApproval(planId: string, approvalId: string, snapshotFingerprint: string, sourcePlanDigest = computePlanDigest(this.requirePlan(planId).plan)): void {
    if (!approvalId.startsWith("approval-ref:")) throw new Error("Workflow approval binding requires a stable non-secret approval reference.");
    const { record, batch, admission } = this.admittedBatch(planId);
    const claim: ApprovalClaim = { approvalId, snapshotFingerprint, sourcePlanDigest };
    if (batch.approval) {
      if (!approvalConflict(batch, claim)) return;
      throw new Error(`Workflow plan ${planId} already has a different approval binding.`);
    }
    this.append(this.approvalBound(record, claim, admission.digest, iso(this.now)));
  }

  public beginApply(planId: string, approvalId: string, snapshotFingerprint: string, sourcePlanDigest = computePlanDigest(this.requirePlan(planId).plan)): void {
    if (!approvalId.startsWith("approval-ref:")) throw new Error("Workflow apply requires a stable non-secret approval reference.");
    const { record, batch, admission } = this.admittedBatch(planId);
    const claim: ApprovalClaim = { approvalId, snapshotFingerprint, sourcePlanDigest };
    assertApplyable(planId, batch, admission.snapshotFingerprint, claim);
    const at = iso(this.now);
    this.store.appendBatch([
      ...(batch.approval ? [] : [this.approvalBound(record, claim, admission.digest, at)]),
      { eventId: eventId("batch.claimed", record.batchId), at, type: "batch.claimed", jobId: record.jobId, batchId: record.batchId },
      { eventId: eventId("batch.executing", record.batchId), at, type: "batch.executing", jobId: record.jobId, batchId: record.batchId },
    ]);
  }

  public rejectBeforeApply(planId: string, panelReceipt: StoredReceipt): void {
    this.applyReceipt(planId, panelReceipt, (record, receipt) => ({ eventId: eventId("batch.rejected", `${record.batchId}:${receipt.receiptId}`), at: iso(this.now), type: "batch.rejected", jobId: record.jobId, batchId: record.batchId, receipt }));
    this.divergences.delete(planId);
  }

  public abandonBeforeApply(planId: string, panelReceipt: StoredReceipt): void {
    this.applyReceipt(planId, panelReceipt, (record, receipt) => ({ eventId: eventId("batch.abandonedBeforeApply", `${record.batchId}:${receipt.receiptId}`), at: iso(this.now), type: "batch.abandonedBeforeApply", jobId: record.jobId, batchId: record.batchId, receipt }));
    this.divergences.delete(planId);
  }

  public rejectUndo(planId: string, panelReceipt: StoredReceipt): void {
    this.applyUndoReceipt(planId, panelReceipt, (record, receipt) => ({ eventId: eventId("batch.undoRejected", `${record.batchId}:${receipt.receiptId}`), at: iso(this.now), type: "batch.undoRejected", jobId: record.jobId, batchId: record.batchId, receipt }));
  }

  public claim(planId: string): void { this.transition("batch.claimed", this.requirePlan(planId)); }

  public executing(planId: string): void {
    const record = this.requirePlan(planId);
    if (this.store.getState().batches[record.batchId]?.lifecycle === "queued") this.claim(planId);
    if (this.store.getState().batches[record.batchId]?.lifecycle === "claimed") this.transition("batch.executing", record);
  }

  public receipt(planId: string, panelReceipt: StoredReceipt): void {
    this.applyReceipt(planId, panelReceipt, (record, receipt) => ({ eventId: eventId("batch.receipt", `${record.batchId}:${receipt.receiptId}`), at: iso(this.now), type: "batch.receipt", jobId: record.jobId, batchId: record.batchId, receipt }));
    this.divergences.delete(planId);
  }

  public reconcile(planId: string, panelReceipt: StoredReceipt): void {
    const priorReceiptId = this.store.getState().batches[this.requirePlan(planId).batchId]?.execution.receiptId;
    if (!priorReceiptId) throw new Error(`Workflow plan ${planId} has no receipt to reconcile.`);
    const reconciled = this.applyReceipt(planId, panelReceipt, (record, receipt) => ({ eventId: eventId("batch.reconciled", `${record.batchId}:${receipt.receiptId}`), at: iso(this.now), type: "batch.reconciled", jobId: record.jobId, batchId: record.batchId, priorReceiptId, receipt }));
    if (reconciled) this.divergences.delete(planId);
  }

  public cancel(planId: string): void {
    const record = this.requirePlan(planId);
    const current = this.store.getState().batches[record.batchId];
    if (current && !SETTLED_LIFECYCLES.includes(current.lifecycle)) this.transition("batch.cancelRequested", record);
  }

  public requestUndo(planId: string, expectedFingerprint: string): void {
    const record = this.requirePlan(planId);
    const at = iso(this.now);
    const key = `${record.batchId}:${record.undoSequence}`;
    const request: WorkflowEvent = { eventId: eventId("batch.undoRequested", key), at, type: "batch.undoRequested", jobId: record.jobId, batchId: record.batchId, expectedFingerprint };
    const state = this.store.getState();
    if (state.jobs[record.jobId]?.status === "completed" && state.activeJobId === null) this.store.appendBatch([{ eventId: eventId("job.undoOpened", key), at, type: "job.undoOpened", jobId: record.jobId }, request]);
    else this.append(request);
  }

  public claimUndo(planId: string): void { this.undoTransition("batch.undoClaimed", this.requirePlan(planId)); }

  public beginUndo(planId: string): void {
    const record = this.requirePlan(planId);
    const at = iso(this.now);
    const dispatch = this.store.getState().batches[record.batchId]?.recovery.dispatch;
    if (dispatch === "claimed" || dispatch === "executing") throw Object.assign(new Error(`Workflow undo ${planId} already owns a host dispatch attempt.`), { code: "DUPLICATE_DISPATCH" });
    const key = `${record.batchId}:${record.undoSequence}`;
    this.store.appendBatch([
      { eventId: eventId("batch.undoClaimed", key), at, type: "batch.undoClaimed", jobId: record.jobId, batchId: record.batchId },
      { eventId: eventId("batch.undoExecuting", key), at, type: "batch.undoExecuting", jobId: record.jobId, batchId: record.batchId },
    ]);
  }

  public executingUndo(planId: string): void { this.undoTransition("batch.undoExecuting", this.requirePlan(planId)); }

  public undoReceipt(planId: string, panelReceipt: StoredReceipt): void {
    this.applyUndoReceipt(planId, panelReceipt, (record, receipt) => ({ eventId: eventId("batch.undoReceipt", `${record.batchId}:${receipt.receiptId}`), at: iso(this.now), type: "batch.undoReceipt", jobId: record.jobId, batchId: record.batchId, receipt }));
  }

  public reconcileUndo(planId: string, panelReceipt: StoredReceipt): void {
    const priorReceiptId = this.store.getState().batches[this.requirePlan(planId).batchId]?.recovery.undoReceiptId;
    if (!priorReceiptId) throw new Error(`Workflow plan ${planId} has no uncertain undo receipt to reconcile.`);
    this.applyUndoReceipt(planId, panelReceipt, (record, receipt) => ({ eventId: eventId("batch.undoReconciled", `${record.batchId}:${receipt.receiptId}`), at: iso(this.now), type: "batch.undoReconciled", jobId: record.jobId, batchId: record.batchId, priorReceiptId, receipt }));
  }

  public projection(jobId?: string, continuation: WorkflowContinuationInput | null = null): WorkflowProjection {
    return buildProjection({ state: this.store.project(), plans: this.plans, divergences: this.divergences, providerFailures: this.providerFailures, notices: this.notices, recovery: this.store.recovery(), resumeSupported: this.store.resumeSupported }, jobId, continuation);
  }

  private requirePlan(planId: string): WorkflowPlanRecord {
    const record = this.plans.get(planId);
    if (!record) throw new Error(`Workflow plan ${planId} is not admitted.`);
    return record;
  }

  private admittedBatch(planId: string): { readonly record: WorkflowPlanRecord; readonly batch: WorkflowBatch; readonly admission: NonNullable<WorkflowBatch["admission"]> } {
    const record = this.requirePlan(planId);
    const batch = this.store.getState().batches[record.batchId];
    if (!batch?.admission) throw new Error(`Workflow plan ${planId} has no admission.`);
    return { record, batch, admission: batch.admission };
  }

  private evidenceContext(jobId: WorkflowId): EvidenceContext {
    const goal = this.store.getState().jobs[jobId]?.goalSummary;
    return { ...(goal === undefined ? {} : { goal }), ...(this.designContext?.(jobId) ?? { designed: false, motion: false }) };
  }

  private clearSupersededFailure(jobId: WorkflowId): { readonly staleBlocker?: string } {
    try {
      this.clearProviderFailure(jobId);
      return {};
    } catch (caught) {
      return { staleBlocker: decodeOrThrow(thrownFailure("PROVIDER_FAILURE_NOT_CLEARED"), caught).message };
    }
  }

  private approvalBound(record: WorkflowPlanRecord, claim: ApprovalClaim, digest: string, at: string): WorkflowEvent {
    return { eventId: eventId("batch.approvalBound", `${record.batchId}:${claim.approvalId}`), at, type: "batch.approvalBound", jobId: record.jobId, batchId: record.batchId, approvalId: claim.approvalId, sourcePlanDigest: claim.sourcePlanDigest, digest, snapshotFingerprint: claim.snapshotFingerprint };
  }

  private transition(type: BatchTransition, record: WorkflowPlanRecord): void {
    this.append({ eventId: eventId(type, record.batchId), at: iso(this.now), type, jobId: record.jobId, batchId: record.batchId });
  }

  private undoTransition(type: UndoTransition, record: WorkflowPlanRecord): void {
    this.append({ eventId: eventId(type, `${record.batchId}:${record.undoSequence}`), at: iso(this.now), type, jobId: record.jobId, batchId: record.batchId });
  }

  private applyReceipt(planId: string, panelReceipt: StoredReceipt, build: (record: WorkflowPlanRecord, receipt: WorkflowReceipt) => WorkflowEvent): boolean {
    const record = this.requirePlan(planId);
    const receipt = workflowReceipt({ receipt: panelReceipt, record, now: this.now, evidenceContext: this.evidenceContext(record.jobId) });
    const appended = this.appendTracked(build(record, receipt));
    if (appended) this.plans.set(planId, { ...record, receiptSequence: record.receiptSequence + 1 });
    return appended;
  }

  private applyUndoReceipt(planId: string, panelReceipt: StoredReceipt, build: (record: WorkflowPlanRecord, receipt: WorkflowUndoReceipt) => WorkflowEvent): void {
    const record = this.requirePlan(planId);
    const receipt = workflowUndoReceipt(panelReceipt, record, this.now);
    if (this.appendTracked(build(record, receipt))) this.plans.set(planId, { ...record, undoSequence: record.undoSequence + 1 });
  }
}

export { mutationBehaviorForPlan, safeWorkflowDiagnostic };

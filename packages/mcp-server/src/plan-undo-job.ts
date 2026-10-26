// Undoing one logical job: its applied batches come back newest applied first, and a batch that never applied is never attempted.
import type { StoredPlan, ToolContext } from "./contracts.js";
import { batchOutcome, jobBatches, jobStatus } from "./job-status.js";
import type { JobStatus } from "./job-status.js";
import { jsonOf, objectOf } from "./json.js";
import { now } from "./plan-store.js";
import { toolError, toolSuccess } from "./tool-result.js";
import type { ToolBase, ToolFailure, ToolResult } from "./tool-result.js";
import { receiptOf, undoGroupsOf } from "./stored-receipt.js";
import { batchReceivedAt, expectedFingerprint, outsideUndoStack, sessionPlans, undoGroupName } from "./undo-stack.js";

type JobStack = {
  base: ToolBase;
  context: ToolContext;
  jobId: string;
  head: StoredPlan;
  batches: StoredPlan[];
  status: JobStatus;
  expected: string | undefined;
};

type BatchOrder = { planId: string; times: number; groups: number; undoGroup: string; expectedFingerprint: string | null };
type Skipped = { planId: string; reason: string };

function skippedBatchReason(record: StoredPlan): string {
  const reasons: Readonly<Record<string, string>> = { "not-applied": "never applied by the host", cancelled: "cancelled before it applied", "in-flight": "being applied or undone right now", failed: "the host did not execute it" };
  const reason = reasons[batchOutcome(record)];
  if (reason) return reason;
  return undoGroupsOf(receiptOf(record)) === 0 ? "it changed nothing, so it left no undo step" : "already undone";
}

function nothingToUndo(context: ToolContext, jobId: string, status: JobStatus): ToolFailure {
  const running = jobBatches(context, jobId).filter((entry) => batchOutcome(entry) === "in-flight");
  if (running.length) return toolError("UNDO_IN_PROGRESS", `An undo of job ${jobId} is already in progress: ${running.map((entry) => entry.plan.planId).join(", ")} ${running.length === 1 ? "is" : "are"} with the panel now. Wait for that to settle before asking again. Job ${jobId} is ${status.line}`);
  return toolError("UNDO_NOT_APPLICABLE", status.applied
    ? `Every batch of job ${jobId} that After Effects executed has already been undone.`
    : `No batch of job ${jobId} has been applied, so there is nothing to undo. Job ${jobId} is ${status.line}`);
}

function laterAppliedRefusal({ context, jobId, head }: JobStack): ToolFailure | undefined {
  const headAt = batchReceivedAt(head);
  const later = sessionPlans(context).find((other) => {
    const at = batchReceivedAt(other);
    return other !== head && other.jobId !== jobId && !outsideUndoStack(other) && headAt !== undefined && at !== undefined && at > headAt;
  });
  return later ? toolError("UNDO_NOT_LATEST", `Plan ${later.plan.planId} was applied later than job ${jobId}'s newest batch; undo it first.`) : undefined;
}

function interleavedRefusal({ context, jobId, batches, status }: JobStack): ToolFailure | undefined {
  if (status.undoOrderBasis !== "apply-time") return undefined;
  const times = batches.map((entry) => batchReceivedAt(entry) ?? Number.NaN);
  const oldest = Math.min(...times);
  const newest = Math.max(...times);
  const inJob = new Set(batches.map((entry) => entry.plan.planId));
  const between = sessionPlans(context).find((other) => {
    const at = batchReceivedAt(other);
    return !inJob.has(other.plan.planId) && !outsideUndoStack(other) && at !== undefined && at > oldest && at < newest;
  });
  return between ? toolError("UNDO_NOT_CONTIGUOUS", `Plan ${between.plan.planId} was applied between two batches of job ${jobId}, so the undo stack is not this job's to walk. Undo ${between.plan.planId} itself first, then undo job ${jobId}.`) : undefined;
}

function changedProjectRefusal({ base, expected }: JobStack): ToolFailure | undefined {
  return expected !== undefined && expected !== base.snapshotFingerprint ? toolError("UNDO_PROJECT_CHANGED", "The project changed after this job was applied; nothing was undone. Ask the user to undo in After Effects.") : undefined;
}

function stackRefusal(stack: JobStack): ToolFailure | undefined {
  for (const rule of [laterAppliedRefusal, interleavedRefusal, changedProjectRefusal]) {
    const refusal = rule(stack);
    if (refusal) return refusal;
  }
  return undefined;
}

function batchOrder(entry: StoredPlan): BatchOrder {
  const groups = undoGroupsOf(receiptOf(entry));
  const undone = Math.min(groups, Math.max(0, Math.floor(entry.undo?.undone ?? 0)));
  const remaining = Math.max(1, groups - undone);
  return { planId: entry.plan.planId, times: remaining, groups, undoGroup: undoGroupName(entry.plan.planId, remaining, groups), expectedFingerprint: expectedFingerprint(entry) ?? null };
}

function jobNote(jobId: string, order: readonly BatchOrder[], skipped: readonly Skipped[], status: JobStatus): string {
  const batches = order.length === 1 ? "One batch" : `${order.length} batches`;
  const skippedClause = skipped.length ? `; ${skipped.length} other ${skipped.length === 1 ? "batch is" : "batches are"} skipped (${skipped.map((entry) => `${entry.planId}: ${entry.reason}`).join("; ")})` : "";
  const first = order[0];
  const took = first ? `${first.planId} (${first.times} undo group${first.times === 1 ? "" : "s"})` : "nothing";
  return `${batches} of job ${jobId} ${order.length === 1 ? "is" : "are"} to undo, newest applied first${skippedClause}. This call takes back ${took}; the rest follow as each settles. ${status.line}`;
}

function jobAnswer(stack: JobStack, record: StoredPlan): ToolResult {
  const { base, context, jobId, head, batches, status, expected } = stack;
  const order = batches.map(batchOrder);
  const first = order[0];
  const skipped = jobBatches(context, jobId).filter((entry) => !status.toUndo.includes(entry.plan.planId)).map((entry): Skipped => ({ planId: entry.plan.planId, reason: skippedBatchReason(entry) }));
  return toolSuccess(base, objectOf({
    planId: head.plan.planId,
    requestedPlanId: record.plan.planId,
    status: head.status,
    scope: "job",
    undoGroup: first?.undoGroup,
    times: first?.times,
    groups: status.remainingUndoGroups,
    remaining: status.remainingUndoGroups,
    batchOrder: order.map((entry) => entry.planId),
    batches: order.length,
    skipped: jsonOf(skipped),
    job: jsonOf(status),
    expectedFingerprint: expected ?? null,
    jobUndo: objectOf({ jobId, order: jsonOf(order) }),
    note: jobNote(jobId, order, skipped, status),
  }));
}

/** Undoes the job's newest applied batch, refusing when the undo stack between its batches is not the job's own. */
export function undoJob(base: ToolBase, record: StoredPlan, context: ToolContext): ToolResult {
  const jobId = record.jobId;
  if (!jobId) return toolError("PLAN_NOT_IN_JOB", "This plan is not part of a job, so there is nothing to undo as one. Use scope \"all\" to undo this plan's own undo groups.");
  const status = jobStatus(context, jobId);
  const byId = new Map(jobBatches(context, jobId).map((entry) => [entry.plan.planId, entry]));
  const batches = status.toUndo.flatMap((planId) => byId.get(planId) ?? []);
  const head = batches[0];
  if (!head) return nothingToUndo(context, jobId, status);
  if (batches.some((batch) => batch.approvalCapability?.readSetDigest)) return toolError("SCOPED_UNDO_UNSUPPORTED", "Scoped panel Undo is unsupported; use native After Effects Edit > Undo after checking recent edits.");
  const stack: JobStack = { base, context, jobId, head, batches, status, expected: expectedFingerprint(head) };
  const refusal = stackRefusal(stack);
  if (refusal) return refusal;
  head.status = "undo_requested";
  head.updatedAt = now(context).toISOString();
  return jobAnswer(stack, record);
}

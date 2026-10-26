// The operation queue the in-panel agent fills: ae_queue_add stages a group, ae_queue_fix amends it by queue index, ae_queue_finish seals it, so no plan id ever reaches the model.
import { PLAN_UNDO_BATCH_SIZE } from "@extynt/host-ae";
import type { Infer, JsonArray } from "@extynt/decode";
import type { ProjectSnapshot } from "@extynt/project-graph";
import { cameraPushNotes } from "./camera-push-notes.js";
import type { OperationVerdict } from "./batch.js";
import type { StoredPlan, ToolContext } from "./contracts.js";
import { effectReuseNotes } from "./effect-reuse-notes.js";
import { asObject, objectOf } from "./json.js";
import { amendPlanEdits, editsJson } from "./plan-amend.js";
import { sealPlan } from "./plan-complete.js";
import { PLAN_NO_CHANGE } from "./plan-no-change.js";
import type { SealedPlan } from "./plan-complete.js";
import { acceptedAnswer, atomicFailure, duplicateAnswer, partialAnswer, refusalAnswer } from "./queue-answers.js";
import { arrayArgument } from "./queue-parse.js";
import { closeStaleQueue, duplicateGroup, openQueuedPlan, queuePlanId, queuedCount, restoreCheckpoint, retireClosedQueue } from "./queue-state.js";
import { stageChunks, stageIndependent } from "./queue-stage.js";
import type { Staged, StageScope } from "./queue-stage.js";
import { inQueueVocabulary, queueSummary, queueGroupSignature, queueVocabulary } from "./queue-words.js";
import type { AE_QUEUE_ADD, AE_QUEUE_FIX } from "./tool-specs-plan.js";
import { toolError, toolSuccess } from "./tool-result.js";
import type { ToolBase, ToolFailure, ToolResult } from "./tool-result.js";

export { QUEUE_CHECKPOINT_SIZE } from "./queue-answers.js";

type AddArgs = Infer<typeof AE_QUEUE_ADD.input.decoder>;
type FixArgs = Infer<typeof AE_QUEUE_FIX.input.decoder>;

type Call = {
  readonly base: ToolBase;
  readonly scope: StageScope;
  readonly operations: JsonArray;
  readonly record: StoredPlan | undefined;
  readonly before: number;
  readonly checkpoint: StoredPlan | undefined;
  readonly signature: string;
};

function withClosedNote(result: ToolResult, note: string | undefined): ToolResult {
  if (!note || !result.ok) return result;
  const data = asObject(result.data);
  if (!data) return result;
  const held = data.next;
  return { ...result, data: objectOf({ ...data, closedBatch: note, next: typeof held === "string" ? `${note} ${held}` : held }) };
}

function givenOperations(args: AddArgs): JsonArray | ToolFailure {
  const given = arrayArgument(args.operations, "operations", "operation objects");
  if ("error" in given) return given;
  return given.length ? given : toolError("INVALID_ARGUMENT", "operations must contain at least one operation.");
}

function callOperations(args: AddArgs, context: ToolContext): JsonArray | ToolFailure {
  const given = givenOperations(args);
  if ("error" in given) return given;
  if (!context.queue) return toolError("NO_OPEN_QUEUE", "This caller has no open queue. Use ae_propose_plan for a whole change.");
  return given;
}

function callNotes(call: Call): string[] {
  const { snapshot, context } = call.scope;
  return [...effectReuseNotes(call.operations, snapshot, context.jobCreatedIds?.(call.record?.jobId)), ...cameraPushNotes(call.operations, snapshot)];
}

function refuseCall(call: Call, staged: Staged): ToolResult {
  const { scope, operations, base, before } = call;
  restoreCheckpoint(scope.context, scope.planId, call.checkpoint);
  const partial = stageIndependent(scope, operations, staged.verdicts, call.checkpoint);
  if (partial) return partialAnswer(base, partial, { planId: scope.planId, before, total: operations.length, signature: call.signature, notes: callNotes(call) }, scope.context);
  return refusalAnswer(base, staged.verdicts, { chunked: operations.length > PLAN_UNDO_BATCH_SIZE, failedFrom: staged.failedFrom, failedChunk: staged.failedChunk, after: before, total: operations.length });
}

function stageCall(call: Call): ToolResult {
  const { scope, base } = call;
  const staged = stageChunks(scope, call.operations);
  if (staged.failure) {
    restoreCheckpoint(scope.context, scope.planId, call.checkpoint);
    return atomicFailure(staged.failure);
  }
  if (staged.verdicts.some((verdict: OperationVerdict) => verdict.status === "rejected")) return refuseCall(call, staged);
  const corrected = staged.verdicts.filter((verdict) => verdict.status === "accepted_modified").length;
  const after = queuedCount(scope.context, scope.planId);
  return acceptedAnswer(base, { record: call.record, planId: scope.planId, before: call.before, after, signature: call.signature, corrected, notes: [...staged.notes, ...callNotes(call)] }, scope.snapshot, scope.context);
}

function queueAddOpen(base: ToolBase, snapshot: ProjectSnapshot, args: AddArgs, context: ToolContext): ToolResult {
  const operations = callOperations(args, context);
  if ("error" in operations) return operations;
  const stale = closeStaleQueue(snapshot, context);
  if (stale) return stale;
  const planId = openQueuedPlan(base, snapshot, queueSummary(args.summary, operations), context);
  if (typeof planId !== "string") return planId;
  const record = context.plans?.get(planId);
  const before = queuedCount(context, planId);
  const signature = queueGroupSignature(operations);
  const prior = duplicateGroup(record, before, signature);
  if (prior) return duplicateAnswer(base, prior);
  const checkpoint = record ? structuredClone(record) : undefined;
  return stageCall({ base, scope: { snapshot, planId, context }, operations, record, before, checkpoint, signature });
}

/** Stages a group of operations into the queue's plan, opening the plan on the first call. */
export function queueAdd(base: ToolBase, snapshot: ProjectSnapshot, args: AddArgs, context: ToolContext): ToolResult {
  const closed = retireClosedQueue(context);
  return withClosedNote(queueAddOpen(base, snapshot, args, context), closed);
}

function keepAsDraft(record: StoredPlan): void {
  if (!record.staged) return;
  record.status = "draft";
  delete record.approvalCapability;
  delete record.presentation;
}

function givenEdits(args: FixArgs): JsonArray | ToolFailure {
  const edits = arrayArgument(typeof args.edits === "string" ? args.edits : editsJson(args.edits), "edits", "{op, index, operation} objects");
  if ("error" in edits) return edits;
  return edits.length ? edits : toolError("INVALID_ARGUMENT", "edits must be a non-empty array of {op, index, operation} changes.");
}

/** Changes queued operations by queue index. */
export function queueFix(base: ToolBase, args: FixArgs, context: ToolContext): ToolResult {
  const closed = retireClosedQueue(context);
  const planId = queuePlanId(context);
  if (!planId) return toolError("NO_OPEN_QUEUE", closed ? `There is nothing to fix. ${closed}` : "There is nothing queued to fix. Send operations with ae_queue_add first.");
  const edits = givenEdits(args);
  if ("error" in edits) return edits;
  const fixed = amendPlanEdits(base, { planId, summary: args.summary, edits }, context);
  if (!fixed.ok) return inQueueVocabulary(fixed);
  const record = context.plans?.get(planId);
  if (record) keepAsDraft(record);
  return toolSuccess(base, { queued: queuedCount(context, planId), fixed: edits.length, next: "Fixed. Carry on with the next operations, or ae_queue_finish when the work is whole." });
}

function sealRefusal(failure: ToolFailure): ToolFailure {
  const tail = "Fix those indexes with ae_queue_fix, then ae_queue_finish again. Nothing has been applied.";
  return toolError(failure.error.code, queueVocabulary(failure.error.message.replace(/Fix them with ae_amend_plan[\s\S]*$/, tail)));
}

function sealedAnswer(base: ToolBase, sealed: SealedPlan): ToolResult {
  const groups = sealed.undoGroups;
  const shape = groups === 1 ? "one undo group" : `${groups} undo groups`;
  return toolSuccess(base, objectOf({
    notes: sealed.notes.length ? sealed.notes : undefined,
    sealed: true,
    operationCount: sealed.operationCount,
    undoGroups: groups,
    queued: 0,
    next: `Sealed with ${sealed.operationCount} operations and queued to the panel, which applies it in order as ${shape}. Nothing can be added to it now; start a new queue for anything else.`,
  }));
}

function nothingToFinish(base: ToolBase, closed: string | undefined): ToolResult {
  const held = closed ? `${closed} ` : "";
  return toolSuccess(base, objectOf({ sealed: false, queued: 0, next: `${held}Nothing was open to finish, so nothing was sealed. Any change already applied stands.` }));
}

function dropUnchanged(base: ToolBase, planId: string, context: ToolContext): ToolResult {
  const record = context.plans?.get(planId);
  if (record) record.status = "cancelled";
  context.queue?.set(null);
  return toolSuccess(base, objectOf({ sealed: false, queued: 0, unchanged: true, next: "Every value in the queue is already what it asks for, so nothing was sealed or applied and no undo step was made. If that was the whole request, finish; otherwise queue the next part." }));
}

/** Seals the queue's plan so it can be applied, and closes the queue. With no open queue it is a no-op success: the work already applied stands. */
export function queueFinish(base: ToolBase, snapshot: ProjectSnapshot, context: ToolContext): ToolResult {
  const closed = retireClosedQueue(context);
  const planId = queuePlanId(context);
  if (!planId) return nothingToFinish(base, closed);
  const sealed = sealPlan(snapshot, planId, context);
  if ("error" in sealed) return sealed.error.code === PLAN_NO_CHANGE ? dropUnchanged(base, planId, context) : sealRefusal(sealed);
  context.queue?.set(null);
  return sealedAnswer(base, sealed);
}

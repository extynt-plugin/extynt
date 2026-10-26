// The undo family: taking back what the host applied, by plan id or as the agent's newest work.
import type { Infer } from "@extynt/decode";
import type { StoredPlan, ToolContext } from "./contracts.js";
import { booleanAt, jsonFieldsOf, objectOf, stringAt } from "./json.js";
import { undoJob } from "./plan-undo-job.js";
import { getPlan, now } from "./plan-store.js";
import { receiptOf, undoGroupsOf } from "./stored-receipt.js";
import type { AE_UNDO_AGENT_WORK, AE_UNDO_PLAN } from "./tool-specs-plan.js";
import { toolError, toolSuccess } from "./tool-result.js";
import type { ToolBase, ToolFailure, ToolResult } from "./tool-result.js";
import { batchReceivedAt, expectedFingerprint, outsideUndoStack, planMayHaveMutated, scopedUndoRefusal, sessionPlans, undoGroupName } from "./undo-stack.js";

type UndoArgs = Infer<typeof AE_UNDO_PLAN.input.decoder>;
type AgentUndoArgs = Infer<typeof AE_UNDO_AGENT_WORK.input.decoder>;

/** What undoing one plan would find: its undo groups, or the refusal the real undo gives. */
export type PlanUndoCheck = { ok: true; groups: number; remaining: number } | ToolFailure;

type UndoShape = { groups: number; remaining: number };

function failedRefusal(record: StoredPlan): ToolFailure | undefined {
  const receipt = receiptOf(record);
  if (record.status !== "failed" || !receipt) return undefined;
  if (booleanAt(receipt, "mayHaveMutated") !== true) return toolError("UNDO_NOT_APPLICABLE", "Nothing to undo: this plan changed nothing, so no After Effects undo step exists for it.");
  if (stringAt(receipt, "mutationState") === "mutation-unknown") return toolError("UNDO_MUTATION_UNKNOWN", "This plan failed and it is not known whether it changed anything, so Undo was not pressed (it could remove an earlier step). Check the project, then use Edit > Undo in After Effects yourself if the failed plan left changes.");
  return undefined;
}

function noUndoStepRefusal(record: StoredPlan): ToolFailure | undefined {
  const receipt = receiptOf(record);
  if (!receipt || undoGroupsOf(receipt) !== 0 || !planMayHaveMutated(record)) return undefined;
  return toolError("UNDO_NOT_APPLICABLE", "Nothing to undo: this plan changed nothing in the project, so no After Effects undo step exists for it.");
}

function undoableShape(record: StoredPlan): UndoShape | ToolFailure {
  const receipt = receiptOf(record);
  if (!receipt || !planMayHaveMutated(record)) return toolError("UNDO_NOT_APPLICABLE", "Only an applied or partially applied plan can be undone.");
  const groups = undoGroupsOf(receipt);
  const remaining = groups - Math.min(groups, Math.max(0, Math.floor(record.undo?.undone ?? 0)));
  return remaining <= 0 ? toolError("UNDO_NOT_APPLICABLE", "This plan has already been undone.") : { groups, remaining };
}

function laterRefusal(context: ToolContext, record: StoredPlan): ToolFailure | undefined {
  const receivedAt = batchReceivedAt(record);
  const later = sessionPlans(context).find((other) => {
    const at = batchReceivedAt(other);
    return other !== record && !outsideUndoStack(other) && receivedAt !== undefined && at !== undefined && at > receivedAt;
  });
  return later ? toolError("UNDO_NOT_LATEST", `Plan ${later.plan.planId} was applied later; undo it first.`) : undefined;
}

function stackRefusal(snapshotFingerprint: string, context: ToolContext, record: StoredPlan): ToolFailure | undefined {
  const later = laterRefusal(context, record);
  if (later) return later;
  const expected = expectedFingerprint(record);
  return expected !== undefined && expected !== snapshotFingerprint ? toolError("UNDO_PROJECT_CHANGED", "The project changed after this plan was applied; nothing was undone. Ask the user to undo in After Effects.") : undefined;
}

function groupsNote(groups: number, times: number): string {
  if (groups > 1) return `This plan is ${groups} undo groups; this undoes ${times === 1 ? "the last one" : `the remaining ${times}`}.`;
  return "This plan is one undo group.";
}

function singlePlanRefusal(record: StoredPlan): ToolFailure | undefined {
  return scopedUndoRefusal(record) ?? failedRefusal(record) ?? noUndoStepRefusal(record);
}

/** The refusals `undoPlan` makes for a single plan, asked without changing anything; `currentFingerprint` is the project as it is now. */
export function checkPlanUndo(currentFingerprint: string, record: StoredPlan, context: ToolContext): PlanUndoCheck {
  const entry = singlePlanRefusal(record);
  if (entry) return entry;
  const shape = undoableShape(record);
  if ("error" in shape) return shape;
  return stackRefusal(currentFingerprint, context, record) ?? { ok: true, ...shape };
}

function undoSingle(base: ToolBase, args: UndoArgs, record: StoredPlan, context: ToolContext): ToolResult {
  const shape = undoableShape(record);
  if ("error" in shape) return shape;
  const refusal = stackRefusal(base.snapshotFingerprint, context, record);
  if (refusal) return refusal;
  const scope = args.scope === "last" ? "last" : "all";
  const times = scope === "last" ? 1 : shape.remaining;
  record.status = "undo_requested";
  record.updatedAt = now(context).toISOString();
  return toolSuccess(base, objectOf({ planId: record.plan.planId, status: record.status, undoGroup: undoGroupName(record.plan.planId, shape.remaining, shape.groups), times, scope, groups: shape.groups, remaining: shape.remaining, expectedFingerprint: expectedFingerprint(record) ?? null, note: groupsNote(shape.groups, times) }));
}

/** Presses Undo for the plan: its remaining groups, or only the last, or the whole job it belongs to. */
export function undoPlan(base: ToolBase, args: UndoArgs, context: ToolContext): ToolResult {
  const record = getPlan(args.planId, context);
  if ("error" in record) return record;
  if (args.scope === "job") return scopedUndoRefusal(record) ?? undoJob(base, record, context);
  return singlePlanRefusal(record) ?? undoSingle(base, args, record, context);
}

/** Undoes the newest work the agent applied in this panel session, in the queue's vocabulary. */
export function undoAgentWork(base: ToolBase, args: AgentUndoArgs, context: ToolContext): ToolResult {
  const newest = sessionPlans(context).filter((record) => !outsideUndoStack(record)).sort((left, right) => (batchReceivedAt(right) ?? 0) - (batchReceivedAt(left) ?? 0))[0];
  if (!newest) return toolError("UNDO_NOT_APPLICABLE", "Nothing the agent applied is waiting to be undone in this panel session.");
  const undone = undoPlan(base, { ...args, planId: newest.plan.planId }, context);
  if (!undone.ok) return undone;
  const { planId, ...rest } = jsonFieldsOf(undone.data);
  const undoPlanId = typeof planId === "string" ? planId : undefined;
  return { ...undone, ...(undoPlanId === undefined ? {} : { undoPlanId }), data: { ...rest, summary: newest.plan.summary } };
}

// What the undo family reads from the plans a panel session holds: which are on After Effects' undo stack and when they landed.
import type { StoredPlan, ToolContext } from "./contracts.js";
import { booleanAt, stringAt } from "./json.js";
import { receiptOf, receivedAtOf, undoGroupsOf } from "./stored-receipt.js";
import { toolError } from "./tool-result.js";
import type { ToolFailure } from "./tool-result.js";

/** Every plan this panel session holds, or none. */
export function sessionPlans(context: ToolContext): StoredPlan[] {
  return context.plans ? [...context.plans.values()] : [];
}

/** `extynt — <planId> (3/8)`, or the bare name for a plan that is one undo. */
export function undoGroupName(planId: string, group: number, groups: number): string {
  return groups > 1 ? `extynt — ${planId} (${group}/${groups})` : `extynt — ${planId}`;
}

/** Whether the host's apply of this plan left nothing for Undo to take back. */
export function outsideUndoStack(plan: StoredPlan): boolean {
  const receipt = receiptOf(plan);
  return !receipt || booleanAt(receipt, "mayHaveMutated") !== true || plan.status === "undone" || undoGroupsOf(receipt) === 0;
}

/** When the host received the plan's apply, as milliseconds since the epoch. */
export function batchReceivedAt(record: StoredPlan): number | undefined {
  return receivedAtOf(receiptOf(record));
}

/** The project fingerprint the plan's apply left behind, which Undo must still find. */
export function expectedFingerprint(record: StoredPlan): string | undefined {
  return record.undo?.stateFingerprint ?? stringAt(receiptOf(record), "afterFingerprint");
}

/** Whether the plan may have changed the project, as far as the receipt and status say. */
export function planMayHaveMutated(record: StoredPlan): boolean {
  if (record.status === "verified" || record.status === "applied_unverified" || record.status === "partially_undone") return true;
  return record.status === "failed" && booleanAt(receiptOf(record), "mayHaveMutated") === true;
}

/** The refusal for a plan applied with a scoped read set, which panel Undo cannot take back. */
export function scopedUndoRefusal(record: StoredPlan): ToolFailure | undefined {
  if (!record.approvalCapability?.readSetDigest) return undefined;
  return toolError("SCOPED_UNDO_UNSUPPORTED", "Scoped panel Undo is unsupported. The plan was applied as one native After Effects undo group; use Edit > Undo in After Effects after checking your recent edits.");
}

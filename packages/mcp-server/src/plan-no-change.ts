// Spots a plan that changes nothing: every row's value, as read back from the project, already equals the value the plan writes.
import type { PlanValueRow } from "./plan-rows.js";

/** The refusal code a seal answers with when the plan would change nothing. */
export const PLAN_NO_CHANGE = "PLAN_NO_CHANGE";

const CLIPPED = "…";

function isUnchanged(row: PlanValueRow): boolean {
  const { before, after } = row;
  return before !== null && after !== null && before === after && !after.endsWith(CLIPPED);
}

/** Whether the plan has rows and every one of them leaves its value as it is; a row without a known current value counts as a change. */
export function changesNothing(rows: readonly PlanValueRow[]): boolean {
  return rows.length > 0 && rows.every(isUnchanged);
}

/** What the panel knows about each plan's status, kept apart from any card so every view reads the same facts. */
import { isActionable } from "./panel-plan-labels.js";
import type { Receipt } from "./receipt.js";

interface PlanFacts {
  readonly mayHaveMutated: boolean;
  readonly postcondition: string | null;
  readonly updatedAt: string | null;
  readonly visual: boolean;
}

const NO_FACTS: PlanFacts = { mayHaveMutated: false, postcondition: null, updatedAt: null, visual: false };

const statuses = new Map<string, string>();
const facts = new Map<string, PlanFacts>();
const receipts = new Map<string, Receipt>();
const appliedAt = new Map<string, number>();
const picked = new Set<string>();
const dropReasons = new Map<string, string>();

/** The plan's status, or "prepared" for a plan the panel has not heard about. */
export function planStatusOf(planId: string): string {
  return statuses.get(planId) ?? "prepared";
}

/** The plan's status, or null for a plan the panel has not heard about. */
export function knownStatus(planId: string): string | null {
  return statuses.get(planId) ?? null;
}

/** What the sidecar reported about how the plan ended. */
export function planFactsOf(planId: string): PlanFacts {
  return facts.get(planId) ?? NO_FACTS;
}

/** The receipt of the plan's last apply or undo, when this panel holds one. */
export function receiptOf(planId: string): Receipt | null {
  return receipts.get(planId) ?? null;
}

/** When this panel first saw the plan leave progress, in milliseconds. */
export function appliedAtOf(planId: string): number | null {
  return appliedAt.get(planId) ?? null;
}

/** Keeps the receipt an apply returned. */
export function recordReceipt(planId: string, receipt: Receipt): void {
  receipts.set(planId, receipt);
}

function inProgress(status: string | undefined): boolean {
  return status !== undefined && (status === "draft" || isActionable(status) || status === "approved" || status === "applying");
}

/** A status a list read or an approval reported. Never moves a settled plan back to Ready: a late "prepared" is stale. */
export function setPlanStatus(planId: string, status: string): void {
  const before = statuses.get(planId);
  if (before !== undefined && !inProgress(before) && isActionable(status)) return;
  statuses.set(planId, status);
  if (!isActionable(status) && !appliedAt.has(planId) && inProgress(before)) appliedAt.set(planId, Date.now());
}

/** Keeps what the plan list said about how a plan ended. */
export function setPlanFacts(planId: string, next: PlanFacts): void {
  facts.set(planId, next);
}

/** A plan a variant pick left: it waits for Apply like any plan, though the plan list marks it as one of the options. */
export function markPicked(planId: string): void {
  picked.add(planId);
}

/** The plans variant picks have left. */
export function pickedPlanIds(): string[] {
  return [...picked];
}

/** Why the sidecar dropped a plan (a restart lost it before Apply), by plan id; a discarded change says so. */
export function recordDropReason(planId: string, reason: string): void {
  dropReasons.set(planId, reason);
}

/** Why the plan was dropped, or "". */
export function dropReasonOf(planId: string): string {
  return dropReasons.get(planId) ?? "";
}

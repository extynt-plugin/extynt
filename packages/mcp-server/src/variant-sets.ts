/**
 * Variant sets: one control, two to four values the MODEL chose, each an ordinary approval-required plan.
 *
 * Nothing in a set is applied until the user picks. A pick closes the set, cancels every other plan in it and leaves
 * exactly one plan to go through the normal approval, apply, read-back and verification path; "none of these" cancels
 * all. A candidate equal to the control's current value is a no-op choice with no plan: picking it only closes the set.
 * The sidecar holds the sets (`ToolContext.variants`); this module is the state machine, with no I/O.
 */
import type { StoredPlan, ToolContext } from "./contracts.js";
import { now } from "./plan-store.js";
import { toolError } from "./tool-result.js";
import type { JsonValue } from "@extynt/decode";
import type { ToolFailure } from "./tool-dispatch.js";

/** Whether a set is still waiting for the user, was answered with a pick, or was closed without one. */
export type VariantStatus = "open" | "picked" | "dismissed";
/** Why a set closed: what the user did, or why the sidecar closed it for them. */
export type VariantReason = "picked" | "kept_current" | "dismissed" | "superseded" | "stale" | "expired";

/** The value of a numeric control: one number, or a short list of them. */
export type VariantValue = number | readonly number[];

/** One option in a set; `planId` is null for the option equal to the control's current value, which needs no plan. */
export interface VariantCandidate {
  readonly label: string;
  readonly value: VariantValue;
  readonly planId: string | null;
  readonly current: boolean;
}

/** The one effect control a set is about, addressed the way set_effect_control addresses it. */
export interface VariantTarget {
  readonly compositionId: string;
  readonly layerId: string;
  readonly effectPath: string;
  readonly propertyPath: string;
  readonly effectMatchName: string;
}

/** Names as the project snapshot shows them, for the card. Untrusted text, shown as text. */
export interface VariantNames {
  readonly composition: string;
  readonly layer: string;
  readonly effect: string;
  readonly control: string;
}

/** A set of options for one control, with the state the user's answer moves it through. */
export interface VariantSet {
  readonly setId: string;
  status: VariantStatus;
  readonly question: string;
  readonly target: VariantTarget;
  readonly names: VariantNames;
  readonly currentValue: VariantValue;
  readonly snapshotFingerprint: string;
  readonly candidates: ReadonlyArray<VariantCandidate>;
  readonly createdAt: string;
  closedAt?: string;
  reason?: VariantReason;
  pickedPlanId?: string | null;
}

/** At most this many sets are remembered; closed ones go first. */
export const MAX_VARIANT_SETS = 24;

const WITHDRAWABLE = new Set(["draft", "prepared", "presented"]);

type Refusal = ToolFailure & { set: VariantSet };

/** What `chooseVariant` did: the plan left to approve, a closed set, or a refusal that names what to change. */
export type ChooseOutcome =
  | { ok: true; outcome: "picked"; set: VariantSet; plan: StoredPlan }
  | { ok: true; outcome: "kept_current" | "dismissed"; set: VariantSet }
  | (ToolFailure & { set?: VariantSet });

function setPlans(context: ToolContext, set: VariantSet): StoredPlan[] {
  return set.candidates.flatMap((candidate) => {
    const record = candidate.planId ? context.plans?.get(candidate.planId) : undefined;
    return record ? [record] : [];
  });
}

function cancelSetPlans(context: ToolContext, set: VariantSet, except?: string): void {
  const stamp = now(context).toISOString();
  for (const record of setPlans(context, set)) {
    if (record.plan.planId === except || !WITHDRAWABLE.has(record.status)) continue;
    record.status = "cancelled";
    record.updatedAt = stamp;
  }
}

/** Closes a set and withdraws every plan in it that was not approved or applied, except the one picked; none is ever applied by this. */
export function closeVariantSet(context: ToolContext, set: VariantSet, outcome: { status: Exclude<VariantStatus, "open">; reason: VariantReason; pickedPlanId?: string | null }): void {
  set.status = outcome.status;
  set.reason = outcome.reason;
  set.closedAt = now(context).toISOString();
  if (outcome.pickedPlanId !== undefined) set.pickedPlanId = outcome.pickedPlanId;
  cancelSetPlans(context, set, typeof outcome.pickedPlanId === "string" ? outcome.pickedPlanId : undefined);
}

/** Keeps the store bounded: when over the cap the oldest closed sets are forgotten, never an open one. */
export function pruneVariantSets(variants: Map<string, VariantSet>): void {
  for (const [setId, set] of variants) {
    if (variants.size <= MAX_VARIANT_SETS) return;
    if (set.status !== "open") variants.delete(setId);
  }
}

/** The sets in the store, newest first. */
export function listVariantSets(context: ToolContext, limit = MAX_VARIANT_SETS): VariantSet[] {
  return [...(context.variants?.values() ?? [])].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, limit);
}

function closedRefusal(set: VariantSet): Refusal {
  const said = set.reason === "picked" || set.reason === "kept_current" ? "already answered" : "no longer open";
  return { ...toolError("VARIANT_SET_CLOSED", `These options are ${said}; nothing was changed by this.`), set };
}

function staleRefusal(context: ToolContext, set: VariantSet, reason: "stale" | "expired"): Refusal {
  closeVariantSet(context, set, { status: "dismissed", reason });
  const why = reason === "stale"
    ? "The project changed after these options were offered, so none of them can be applied safely."
    : "These options were offered too long ago to be applied safely.";
  return { ...toolError(reason === "stale" ? "VARIANT_SET_STALE" : "VARIANT_SET_EXPIRED", `${why} Nothing was changed. Ask for them again.`), set };
}

function unavailableRefusal(context: ToolContext, set: VariantSet, label: string): Refusal {
  closeVariantSet(context, set, { status: "dismissed", reason: "dismissed" });
  return { ...toolError("VARIANT_PLAN_UNAVAILABLE", `The “${label}” option can no longer be applied (it was withdrawn or already used). Nothing was changed. Ask for new options.`), set };
}

function approvalExpired(context: ToolContext, record: StoredPlan): boolean {
  const capability = record.approvalCapability;
  return !!capability && Date.parse(capability.expiresAt) <= now(context).getTime();
}

function standingPlan(context: ToolContext, set: VariantSet, candidate: VariantCandidate, currentFingerprint: string): { plan: StoredPlan } | Refusal {
  if (currentFingerprint !== set.snapshotFingerprint) return staleRefusal(context, set, "stale");
  const record = candidate.planId ? context.plans?.get(candidate.planId) : undefined;
  if (!record || !WITHDRAWABLE.has(record.status)) return unavailableRefusal(context, set, candidate.label);
  if (approvalExpired(context, record)) return staleRefusal(context, set, "expired");
  return { plan: record };
}

function pickedCandidate(set: VariantSet, choice: JsonValue | undefined): VariantCandidate | undefined {
  if (typeof choice !== "number" || !Number.isInteger(choice)) return undefined;
  return set.candidates[choice];
}

function dismissed(context: ToolContext, set: VariantSet): ChooseOutcome {
  closeVariantSet(context, set, { status: "dismissed", reason: "dismissed" });
  return { ok: true, outcome: "dismissed", set };
}

function keptCurrent(context: ToolContext, set: VariantSet): ChooseOutcome {
  closeVariantSet(context, set, { status: "picked", reason: "kept_current", pickedPlanId: null });
  return { ok: true, outcome: "kept_current", set };
}

function pickPlan(context: ToolContext, set: VariantSet, candidate: VariantCandidate, currentFingerprint: string | null): ChooseOutcome {
  if (currentFingerprint === null) return toolError("NO_SNAPSHOT", "After Effects has not reported the project yet, so these options cannot be checked against it. Try again in a moment.");
  const standing = standingPlan(context, set, candidate, currentFingerprint);
  if ("ok" in standing) return standing;
  closeVariantSet(context, set, { status: "picked", reason: "picked", pickedPlanId: standing.plan.plan.planId });
  return { ok: true, outcome: "picked", set, plan: standing.plan };
}

/** A choice is a candidate's index, or "none". Past the refusals, exactly one plan is left to approve, or none. */
export function chooseVariant(context: ToolContext, input: { setId: string; choice: JsonValue | undefined; currentFingerprint: string | null }): ChooseOutcome {
  const set = context.variants?.get(input.setId);
  if (!set) return toolError("VARIANT_SET_NOT_FOUND", "No such set of options is held; it may have been closed when the sidecar restarted. Ask for new options.");
  if (set.status !== "open") return closedRefusal(set);
  if (input.choice === "none") return dismissed(context, set);
  const candidate = pickedCandidate(set, input.choice);
  if (!candidate) return toolError("INVALID_ARGUMENT", "choice must be the number of one of the options, or \"none\".");
  if (candidate.current) return keptCurrent(context, set);
  return pickPlan(context, set, candidate, input.currentFingerprint);
}

/** True only for the plan the user picked from its set; the approval of every other plan in a set is refused. */
export function variantApprovalAllowed(context: ToolContext, record: StoredPlan): boolean {
  if (!record.variantSetId) return true;
  const set = context.variants?.get(record.variantSetId);
  return set?.status === "picked" && set.pickedPlanId === record.plan.planId;
}

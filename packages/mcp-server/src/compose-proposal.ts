// The whole-plan composer's stages: the request every whole-plan tool must carry, the plan it assembles,
// and the draft it keeps when a problem refuses that plan.
import { computePlanDigest, type ActionPlan, type ActionPlanV2Operation } from "@extynt/action-plan";
import { stableStringify, type ProjectSnapshot } from "@extynt/project-graph";
import type { StoredPlan, ToolContext } from "./contracts.js";
import { now, storeDraftPlan } from "./plan-store.js";
import { toolError } from "./tool-result.js";
import { arrayAt, stringAt } from "./json.js";
import type { JsonArray, JsonObject } from "@extynt/decode";
import { keyframeTimeBound } from "./plan-bounds.js";
import { planProblemMessage } from "./plan-problems.js";
import type { PlanProblem } from "./plan-problem.js";
import { refusal } from "./compose-pass.js";
import type { Refusal, Resolved } from "./compose-pass.js";

/** The summary and operations a whole-plan call carries, bounded by the caller's operation limit. */
export function proposalRequest(args: JsonObject, limit: number): Resolved<{ summary: string; rawOperations: JsonArray }> {
  const summary = (stringAt(args, "summary") ?? "").trim();
  if (!summary || summary.length > 512) return refusal("INVALID_ARGUMENT", "summary is required and must be at most 512 characters.");
  const rawOperations = arrayAt(args, "operations") ?? [];
  if (rawOperations.length === 0 || rawOperations.length > limit) return refusal("INVALID_ARGUMENT", `operations must contain 1–${limit} entries.`);
  return { ok: true, value: { summary, rawOperations } };
}

interface ComposedPlanInput {
  planId: string;
  summary: string;
  snapshot: ProjectSnapshot;
  operations: ReadonlyArray<{ stored: ActionPlanV2Operation }>;
  totalKeyframes: number;
  maxExpressionLength: number;
  context: ToolContext;
}

/** The plan a composed batch is submitted as: the operations the walk stored and the bounds it measured. */
export function buildComposedPlan(input: ComposedPlanInput): ActionPlan {
  const plan: ActionPlan = {
    schemaVersion: "0.2", planId: input.planId, snapshotFingerprint: input.snapshot.fingerprint, selectionFingerprint: input.snapshot.selectionFingerprint, freshness: input.snapshot.freshness,
    summary: input.summary, intent: "propose_plan", requiresApproval: true,
    bounds: { maxOperations: input.operations.length, maxKeyframes: Math.max(1, input.totalKeyframes), maxKeyframeTimeSeconds: keyframeTimeBound(input.snapshot, input.operations.map((entry) => entry.stored)), maxExpressionLength: Math.max(1, input.maxExpressionLength) },
    preconditions: [],
    conflicts: [],
    postconditions: [{ code: "OPERATIONS_OBSERVED", description: "Each allowlisted operation is applied in one bounded undo group and verified with a fresh snapshot." }],
    operations: input.operations.map((entry) => entry.stored),
    provenance: { source: "agent", createdAt: now(input.context).toISOString() },
    digest: "",
  };
  plan.digest = computePlanDigest(plan);
  return plan;
}

/** A refused whole-plan call: its first problem, and the draft the panel keeps when there is one. */
export interface PlanProblemRefusal {
  ok: false;
  error: Refusal;
  data: { planId: string; status: "draft"; problems: PlanProblem[]; storedOperations: ActionPlan["operations"]; bindings: Record<string, string> };
}

/** A refused plan reports its first problem, and keeps its draft only when the caller amends it. */
export function problemRefusal(input: {
  plan: ActionPlan;
  first: PlanProblem;
  problems: PlanProblem[];
  bindings: Record<string, string>;
  snapshot: ProjectSnapshot;
  context: ToolContext;
  retainDraft: boolean;
}): PlanProblemRefusal {
  if (input.retainDraft) storeDraftPlan(input.plan, input.context, input.bindings);
  return {
    ...toolError(input.first.code, planProblemMessage(input.plan.planId, input.problems)),
    data: { planId: input.plan.planId, status: "draft" as const, problems: input.problems, storedOperations: input.plan.operations, bindings: input.bindings },
  };
}

function isWaiting(record: StoredPlan, plan: ActionPlan): boolean {
  const open = record.status === "prepared" || record.status === "presented";
  return open && !record.receipt && record.plan.snapshotFingerprint === plan.snapshotFingerprint;
}

/** The plan this same change was already proposed as and nobody has acted on: a retried call (a timeout the caller never saw, a second provider replaying the turn) gets that plan back instead of a second card. */
export function unactedEquivalent(plan: ActionPlan, context: ToolContext): StoredPlan | undefined {
  const wanted = stableStringify(plan.operations);
  const sameChange = (record: StoredPlan): boolean => isWaiting(record, plan) && record.plan.summary === plan.summary && stableStringify(record.plan.operations) === wanted;
  return [...(context.plans?.values() ?? [])].find(sameChange);
}

/** The plans still waiting for approval beside a new one, with the advice to cancel the ones it replaces. */
export interface SiblingPlans {
  plans: Array<{ planId: string; summary: string }>;
  note: string;
}

/** Other plans on this snapshot still waiting for approval: a revised proposal leaves its first draft behind as a second card unless the agent cancels it. */
export function openSiblingPlans(plan: ActionPlan, context: ToolContext): SiblingPlans | undefined {
  const siblings = [...(context.plans?.values() ?? [])].filter((record) => isWaiting(record, plan) && record.plan.planId !== plan.planId);
  if (!siblings.length) return undefined;
  const plans = siblings.slice(0, 8).map((record) => ({ planId: record.plan.planId, summary: record.plan.summary }));
  return { plans, note: "These plans are still waiting for approval. Cancel any this one replaces with ae_cancel_plan, so the user does not see both." };
}

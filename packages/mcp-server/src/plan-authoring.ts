// What the step-by-step plan tools share: the plan being authored, and the shell that holds its operations.
import { computePlanDigest } from "@extynt/action-plan";
import type { ActionPlan, ActionPlanV2Operation } from "@extynt/action-plan";
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { StoredPlan, ToolContext } from "./contracts.js";
import { composedOperations } from "./operations.js";
import { planNotHeld } from "./plan-lost.js";
import type { PlanSizes } from "./plan-bounds.js";
import { keyframeTimeBound } from "./plan-bounds.js";
import { toolError } from "./tool-result.js";
import type { ToolFailure } from "./tool-result.js";

const AUTHORING_STATUSES: ReadonlySet<string> = new Set(["draft", "prepared", "presented"]);

/** At most this many authoring batches may accumulate; one call adds one batch. */
export const MAX_AUTHORING_BATCHES = 32;

/** The plan the id names when it is still being authored. */
export function authoringRecord(planId: string, context: ToolContext): StoredPlan | ToolFailure {
  if (!planId) return toolError("INVALID_ARGUMENT", "planId is required.");
  const record = context.plans?.get(planId);
  if (!record) return planNotHeld(planId, context);
  if (!record.staged) return toolError("PLAN_NOT_AUTHORING", "This plan was written in one call rather than authored step by step, so there is nothing to add to it. Change it with ae_amend_plan, or start a new plan with ae_plan_create.");
  if (!AUTHORING_STATUSES.has(record.status)) return toolError("PLAN_NOT_EDITABLE", `A plan in state ${record.status} is no longer being authored. Start a new plan with ae_plan_create.`);
  return record;
}

type AuthoredIdentity = { planId: string; summary: string; createdAt: string };

/** The plan holding the operations authored so far, measured and digested against the snapshot. */
export function authoredShell(identity: AuthoredIdentity, snapshot: ProjectSnapshot, operations: ActionPlanV2Operation[], sizes: PlanSizes): ActionPlan {
  const plan: ActionPlan = {
    schemaVersion: "0.2",
    planId: identity.planId,
    snapshotFingerprint: snapshot.fingerprint,
    selectionFingerprint: snapshot.selectionFingerprint,
    freshness: snapshot.freshness,
    summary: identity.summary,
    intent: "author_plan",
    requiresApproval: true,
    bounds: {
      maxOperations: Math.max(1, operations.length),
      maxKeyframes: Math.max(1, sizes.totalKeyframes),
      maxKeyframeTimeSeconds: keyframeTimeBound(snapshot, operations),
      maxExpressionLength: Math.max(1, sizes.maxExpressionLength),
    },
    preconditions: [],
    conflicts: [],
    postconditions: [{ code: "OPERATIONS_OBSERVED", description: "Each allowlisted operation is applied in one bounded undo step and verified with a fresh snapshot." }],
    operations,
    provenance: { source: "agent", createdAt: identity.createdAt },
    digest: "",
  };
  plan.digest = computePlanDigest(plan);
  return plan;
}

/** The operations a plan holds: those staged batch by batch while it is authored, otherwise the plan's own. */
export function heldOperations(record: StoredPlan): ActionPlanV2Operation[] {
  const staged = record.staged ?? [];
  return staged.length ? staged.flatMap((entry) => entry.operations) : composedOperations(record.plan);
}

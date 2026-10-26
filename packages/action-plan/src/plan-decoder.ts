// The decoder for a whole v0.2 plan: the envelope fields, the conditions and every operation, so a decoded plan carries only what was checked.
import { array, literal, nullable, object, optional, refine, string, strictObject, union, type Decoder, type Infer } from "@extynt/decode";
import { actionPlanOperation } from "./operation-decoder.js";
import { planBounds } from "./plan-decoders.js";

const BOUNDED_TEXT = { nonEmpty: true, maxLength: 512 } as const;

const conditionTarget = strictObject({ compositionId: string(), layerId: string(), effectPath: optional(string()), propertyPath: optional(string()) });
const condition = union(string(BOUNDED_TEXT), strictObject({ code: string({ nonEmpty: true }), description: string({ nonEmpty: true }), target: optional(conditionTarget) }));
const conditionList = array(condition);
const freshness = object({ revision: string({ nonEmpty: true }), capturedAt: string({ nonEmpty: true }), receivedAt: optional(nullable(string())) });
const provenance = object({ source: literal("user", "agent", "fixture"), createdAt: optional(string()) });

const planFields = strictObject({
  schemaVersion: literal("0.2"),
  planId: string({ nonEmpty: true, maxLength: 256 }),
  snapshotFingerprint: string({ nonEmpty: true }),
  selectionFingerprint: string({ nonEmpty: true }),
  freshness,
  summary: string({ maxLength: 512 }),
  operations: array(actionPlanOperation, { minLength: 1 }),
  requiresApproval: literal(true),
  intent: optional(string()),
  provenance: optional(provenance),
  expiresAt: optional(string()),
  bounds: planBounds,
  preconditions: conditionList,
  conflicts: conditionList,
  postconditions: conditionList,
  digest: optional(string()),
  planDigest: optional(string()),
});

type PlanFields = Infer<typeof planFields>;

function hasDigest(plan: PlanFields): plan is PlanFields {
  return plan.digest !== undefined || plan.planDigest !== undefined;
}

/** A whole v0.2 plan: no field beyond the plan's own, every field of its type, each operation decoded by its own type, and a digest. */
export const actionPlanV2: Decoder<PlanFields> = refine(planFields, hasDigest, "a plan with a digest");

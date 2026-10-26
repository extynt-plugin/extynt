// Plan validation: the v0.2 envelope and digest, the all-problems diagnostic pass, and the native-vector merge. The per-kind rules
// live in operation-rules; this module orders the checks and decides what the caller is told.
import type { ProjectSnapshot } from "@extynt/project-graph";
import { accepts, decode, type JsonObject, type JsonValue } from "@extynt/decode";
import { isJsonObject } from "./json-shape.js";
import { metadataReadSetJson } from "./metadata-readset.js";
import { validateOperation, type PlanPosition } from "./operation-dispatch.js";
import { actionPlanV2 } from "./plan-decoder.js";
import { computePlanDigest, planDigestJson } from "./plan-digest.js";
import { conditionsError, headerError, readEnvelope, type PlanEnvelope } from "./plan-envelope.js";
import { toJsonValue } from "./plain-json.js";
import { observedProperty, resolveNativeVectorValue, type NativeVectorResolution } from "./property-rules.js";
import { ACTION_PLAN_SCHEMA, type ActionPlanV2, type ActionPlanV2Operation, type PlanBounds, type PlanInput, type PlanValidation } from "./plan-types.js";
import { planWarnings } from "./warning-rules.js";
import { invalid, isPositiveInteger, isRefusal, objectAt, arrayAt, type Refusal } from "./validation-primitives.js";

const SCOPED_READ_SET_MESSAGE = "Scoped observations support exact bounded layer renames, one static existing Gaussian Blur Blurriness assignment, or one absent Gaussian creation with every initialization value explicit, backed by complete local read sets. Other dependencies remain unknown. For any other plan, call ae_refresh_snapshot (a whole-project read) and propose it again.";
type OptionalBound = "maxKeyframes" | "maxKeyframeTimeSeconds" | "maxExpressionLength";
const NOT_AN_OBJECT = "Plan must be an object.";

/** One problem found in one operation. */
export interface OperationProblem { index: number; code: string; message: string }

export { computePlanDigest, resolveNativeVectorValue };

/**
 * Every operation problem, not just the first: a diagnostic pass for repair, not a soundness proof, so validateActionPlan stays the
 * authority on whether a plan may run. A declared bound that is malformed falls back to what the plan holds; the bounds are validated as a whole elsewhere.
 */
export function collectOperationProblemsJson(value: JsonValue, snapshot?: ProjectSnapshot): OperationProblem[] {
  const plan = Array.isArray(value) ? {} : value;
  if (!isJsonObject(plan)) return [{ index: -1, code: "INVALID_PLAN", message: NOT_AN_OBJECT }];
  const operations = arrayAt(plan, "operations") ?? [];
  const position: PlanPosition = { plan, operations, bounds: operationBounds(plan, operations.length), snapshot };
  return operations.flatMap((_, index) => {
    const result = validateOperation(position, index);
    return result.ok ? [] : [{ index, code: result.code, message: result.message }];
  });
}

/** collectOperationProblemsJson for a value of unknown shape: it is read as the JSON it would serialise to. */
export function collectOperationProblems(value: PlanInput, snapshot?: ProjectSnapshot): OperationProblem[] {
  return collectOperationProblemsJson(toJsonValue(value) ?? null, snapshot);
}

function operationBounds(plan: JsonObject, fallbackCount: number): PlanBounds {
  const declared = objectAt(plan, "bounds");
  const maxOperations = declared?.maxOperations;
  return { maxOperations: isPositiveInteger(maxOperations) ? maxOperations : fallbackCount, ...declaredBound(declared, "maxKeyframes"), ...declaredBound(declared, "maxKeyframeTimeSeconds"), ...declaredBound(declared, "maxExpressionLength") };
}

function declaredBound(declared: JsonObject | undefined, key: OptionalBound): Partial<Record<OptionalBound, number>> {
  const bound = declared?.[key];
  return isPositiveInteger(bound) ? { [key]: bound } : {};
}

/** Fills each null component of a vector write from the value observed on the property. The merge runs at the host-command boundary, so null never reaches Property.setValue; operations without a null component pass through untouched. */
export function resolveNativeVectorWrites(plan: ActionPlanV2, snapshot?: ProjectSnapshot): { ok: true; operations: ActionPlanV2Operation[] } | Refusal {
  const operations: ActionPlanV2Operation[] = [];
  for (const operation of plan.operations) {
    if (operation.type !== "set_layer_property" || !Array.isArray(operation.value) || !operation.value.includes(null)) { operations.push(operation); continue; }
    const observed = observedProperty(snapshot, { ...operation.target, propertyPath: operation.propertyPath });
    const resolution: NativeVectorResolution = resolveNativeVectorValue(operation.role, operation.value, observed?.value);
    if (!resolution.ok) return invalid(resolution.code, `set_layer_property ${operation.propertyPath}: ${resolution.message}`);
    operations.push({ ...operation, value: resolution.value });
  }
  return { ok: true, operations };
}

/** validateActionPlanJson for a value of unknown shape: it is read as the JSON it would serialise to. */
export function validateActionPlan(value: PlanInput, snapshot?: ProjectSnapshot): PlanValidation {
  const json = toJsonValue(value);
  return json === undefined ? invalid("INVALID_PLAN", NOT_AN_OBJECT) : validateActionPlanJson(json, snapshot);
}

/** The validation outcome for a plan: accepted with its warnings, or the first refusal. */
export function validateActionPlanJson(value: JsonValue, snapshot?: ProjectSnapshot): PlanValidation {
  if (typeof value !== "object" || value === null) return invalid("INVALID_PLAN", NOT_AN_OBJECT);
  const plan: JsonObject = isJsonObject(value) ? value : {};
  if (snapshot?.coverage && !metadataReadSetJson(plan, snapshot)) return invalid("READ_SET_UNSUPPORTED", SCOPED_READ_SET_MESSAGE);
  if (plan.schemaVersion === ACTION_PLAN_SCHEMA) return validateV2Plan(plan, snapshot);
  return invalid("INVALID_PLAN", "Expected a v0.2 plan (schemaVersion \"0.2\").");
}

/** True when the value is a whole v0.2 plan: the envelope, the conditions and every operation each decode as their own type. Whether the operations are acceptable is validateActionPlan's decision. */
export function isActionPlanV2(value: JsonValue | undefined): value is JsonObject & ActionPlanV2 {
  return accepts(actionPlanV2)(value);
}

function validateV2Plan(plan: JsonObject, snapshot: ProjectSnapshot | undefined): PlanValidation {
  const envelope = readEnvelope(plan);
  if (isRefusal(envelope)) return envelope;
  const refusal = headerError(envelope, snapshot) ?? conditionsError(envelope) ?? operationsError(envelope, snapshot) ?? digestError(envelope);
  if (refusal) return refusal;
  return decodedPlan(plan, envelope, snapshot);
}

function decodedPlan(plan: JsonObject, envelope: PlanEnvelope, snapshot: ProjectSnapshot | undefined): PlanValidation {
  if (isActionPlanV2(plan)) return { ok: true, plan, warnings: planWarnings(envelope.operations, snapshot) };
  const failure = decode(actionPlanV2, plan);
  const reason = failure.ok ? "it decodes on a second pass" : failure.error.message;
  return invalid("PLAN_DECODER_DISAGREES", `The plan passed its rules but does not decode (${reason}); this is an internal inconsistency.`);
}

function digestError({ record, digest }: PlanEnvelope): Refusal | undefined {
  return planDigestJson(record) === digest ? undefined : invalid("INVALID_DIGEST", "Plan digest does not match the canonical plan contents.");
}

function operationsError({ record, operations, bounds }: PlanEnvelope, snapshot: ProjectSnapshot | undefined): Refusal | undefined {
  const position: PlanPosition = { plan: record, operations, bounds, snapshot };
  let keyframeCount = 0;
  for (let index = 0; index < operations.length; index += 1) {
    const result = validateOperation(position, index);
    if (!result.ok) return result;
    keyframeCount += result.keyframes;
  }
  return bounds.maxKeyframes !== undefined && keyframeCount > bounds.maxKeyframes ? invalid("BOUNDS_EXCEEDED", "The plan contains more keyframes than its declared bound.") : undefined;
}

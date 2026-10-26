// The operation view this package reads: a plan's operations, and operations a caller wrote. Known gap: namesOperation only checks that
// a type is named, yet the composer holds the result as an ActionPlanV2Operation before the plan validator judges it; decoding it
// fully refuses drafts the validator reports precisely (58 tests), and typing the pipeline as drafts reaches apps/sidecar and tools.
import type { ActionPlan, ActionPlanV2Operation, Operation } from "@extynt/action-plan";
import { arrayAt, jsonFieldsOf, stringAt } from "./json.js";
import type { JsonArray, JsonObject } from "@extynt/decode";

/** The operation as plain JSON: fields without a value are dropped. */
export function operationJson(operation: ActionPlanV2Operation | Operation): JsonObject {
  return jsonFieldsOf(operation);
}

/** A plan's own operations, copied so a caller may edit the list and its entries. */
export function composedOperations(plan: ActionPlan): ActionPlanV2Operation[] {
  return plan.operations.map((operation) => ({ ...operation }));
}

function namesOperation(value: JsonObject): value is JsonObject & ActionPlanV2Operation {
  return stringAt(value, "type") !== undefined;
}

/** The object a caller wrote as an operation when it names a type; the plan validator judges the rest. */
export function operationOf(value: JsonObject): ActionPlanV2Operation | undefined {
  return namesOperation(value) ? value : undefined;
}

/** The objects that name an operation type, in order. */
export function operationsOf(values: ReadonlyArray<JsonObject>): ActionPlanV2Operation[] {
  return values.flatMap((value) => operationOf(value) ?? []);
}

/** The keyframe list an operation carries, or undefined when its keyframes are not a list. */
export function operationKeyframes(operation: ActionPlanV2Operation): JsonArray | undefined {
  return arrayAt(operationJson(operation), "keyframes");
}

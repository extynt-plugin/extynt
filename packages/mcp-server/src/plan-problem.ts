// One operation of a plan that cannot run, and the ids an operation brings into existence.
import type { ActionPlanV2Operation } from "@extynt/action-plan";
import { nonEmptyStringAt, objectAt } from "./json.js";
import { isJsonArray, isJsonObject } from "@extynt/decode";
import type { JsonValue } from "@extynt/decode";
import { operationJson } from "./operations.js";

/** One operation that cannot run, and the later operations that depend on what it creates. */
export type PlanProblem = { index: number; type: string; code: string; message: string; dependents?: number[] };

const CREATED_ID_FIELDS = ["newLayerId", "newCompositionId", "newItemId", "newFolderId", "newGroupId", "newMaskId", "newAnimatorId"] as const;

/** Ids an operation brings into existence, which later operations may address. */
export function createdIdsOf(operation: ActionPlanV2Operation): string[] {
  const source = operationJson(operation);
  const ids = [nonEmptyStringAt(objectAt(source, "target"), "layerId"), ...CREATED_ID_FIELDS.map((field) => nonEmptyStringAt(source, field))];
  return [...new Set(ids.flatMap((id) => id ?? []))];
}

/** Every string anywhere inside a value, for "does this refer to that id". */
export function operationStrings(value: JsonValue): string[] {
  if (typeof value === "string") return [value];
  if (isJsonArray(value)) return value.flatMap(operationStrings);
  return isJsonObject(value) ? Object.values(value).flatMap(operationStrings) : [];
}

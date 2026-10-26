// Reads a plan's operations as plain JSON rows, so the completeness checks look at what the plan says and nothing else.
import type { ActionPlanV2Operation } from "@extynt/action-plan";
import { decode } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";

import { jsonValue, rowsOf } from "./decoder-kit.js";

const NEW_OBJECT_PREFIX = "__new__:";

/** A plan as the completeness checks accept it: the operations of an action plan, or the same operations as plain JSON. */
export type PlanOperations = readonly ActionPlanV2Operation[] | readonly JsonObject[];

/** One plan operation as the completeness checks read it, raw or composed: its position, type, fields and target. */
export interface PlanOperation {
  readonly index: number;
  readonly type: string;
  readonly operation: JsonObject;
  readonly target: JsonObject;
}

const DECLARATIONS: Readonly<Record<string, readonly string[]>> = {
  create_layer: ["target.layerId"],
  duplicate_layer: ["newLayerId"],
  derive_layer: ["newLayerId"],
  create_composition: ["newCompositionId"],
  duplicate_composition: ["newCompositionId"],
  precompose_layers: ["newCompositionId", "newLayerId"],
  create_folder: ["newFolderId"],
  import_file: ["newItemId"],
  create_vector_artwork: ["newItemId"],
  add_mask: ["newMaskId"],
  create_shape_group: ["newGroupId"],
  add_text_animator: ["newAnimatorId"],
  add_shape_item: ["newItemId"],
};

const readableFields = rowsOf(jsonValue);

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The object held in a field, or undefined when the field is absent or holds anything else. */
export function objectField(source: JsonObject, key: string): JsonObject | undefined {
  const value = source[key];
  return isJsonObject(value) ? value : undefined;
}

/** The text held in a field, or undefined when the field is absent, empty or not text. */
export function stringField(source: JsonObject, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value ? value : undefined;
}

/** The text held in one of the operation's target fields. */
export function targetString(operation: PlanOperation, key: string): string | undefined {
  return stringField(operation.target, key);
}

function toPlanOperation(raw: ActionPlanV2Operation | JsonObject, index: number): PlanOperation | undefined {
  const fields = decode(readableFields, raw);
  if (!fields.ok) return undefined;
  const type = fields.value.type;
  if (typeof type !== "string") return undefined;
  return { index, type, operation: fields.value, target: objectField(fields.value, "target") ?? {} };
}

/** The operations of a plan that are objects with a type, each keeping its position in the plan. */
export function readOperations(plan: PlanOperations): PlanOperation[] {
  const raws: readonly (ActionPlanV2Operation | JsonObject)[] = plan;
  return raws.flatMap((raw, index) => toPlanOperation(raw, index) ?? []);
}

function isNewObjectId(value: JsonValue | undefined): value is string {
  return typeof value === "string" && value.startsWith(NEW_OBJECT_PREFIX);
}

function declaredAt(operation: PlanOperation, path: string): string | undefined {
  const [head = "", tail] = path.split(".");
  const container = tail === undefined ? operation.operation : objectField(operation.operation, head);
  const value = container?.[tail ?? head];
  return isNewObjectId(value) ? value : undefined;
}

/** The placeholders this operation declares (`__new__:` ids it introduces). */
export function declaredValues(operation: PlanOperation): string[] {
  return (DECLARATIONS[operation.type] ?? []).flatMap((path) => declaredAt(operation, path) ?? []);
}

function placeholderStrings(value: JsonValue): string[] {
  if (isNewObjectId(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(placeholderStrings);
  return isJsonObject(value) ? Object.values(value).flatMap(placeholderStrings) : [];
}

/** Every placeholder this operation reads, excluding the ones it declares itself. */
export function references(operation: PlanOperation): string[] {
  const own = new Set(declaredValues(operation));
  return placeholderStrings(operation.operation).filter((id) => !own.has(id));
}

function layerKey(operation: PlanOperation): string | undefined {
  const compositionId = targetString(operation, "compositionId");
  const layerId = targetString(operation, "layerId");
  return compositionId && layerId ? `${compositionId}\u0000${layerId}` : undefined;
}

/** A property write's identity: layer plus exact property path (or effect path for a control). */
export function propertyKey(operation: PlanOperation): string | undefined {
  const layer = layerKey(operation);
  if (!layer) return undefined;
  const explicit = targetString(operation, "propertyPath");
  if (explicit) return `${layer}\u0000${explicit}`;
  const path = operation.type === "set_layer_property" ? stringField(operation.operation, "propertyPath") : undefined;
  return path ? `${layer}\u0000${path}` : undefined;
}

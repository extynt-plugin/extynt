// Shape groups have three ids: "root", "shape:<n>" (the nth child of Contents, counting from 1) and the
// placeholder create_shape_group declares. A caller who writes the AE-native name, the wrong field, or a
// paint's values inside a `values` object has said something with one right reading; this fixes those and
// refuses the ones the snapshot cannot settle, naming the shape ids the layer actually has.
import type { LayerSnapshot, PropertySnapshot } from "@extynt/project-graph";
import type { OperationChange } from "./batch.js";
import { isSameJson, recordChange, targetLayer } from "./compose-correction-core.js";
import type { CorrectionContext, CorrectionStep } from "./compose-correction-core.js";
import { objectAt, stringAt } from "./json.js";
import { copyFields, fieldsOf } from "./operation-fields.js";
import type { OperationFields } from "./operation-fields.js";

const GROUP_CONSUMERS: ReadonlySet<string> = new Set(["set_shape_path", "ensure_shape_fill", "ensure_shape_stroke", "add_shape_item", "update_shape_item"]);
const PAINT_FIELDS: Readonly<Record<string, readonly string[]>> = { ensure_shape_fill: ["color", "opacity"], ensure_shape_stroke: ["color", "width", "opacity"] };
const ROOT_VECTORS = "ADBE Root Vectors Group";
const VECTOR_GROUP = "ADBE Vector Group";
const NATIVE_GROUP_NAMES: ReadonlySet<string> = new Set([VECTOR_GROUP, `${ROOT_VECTORS}/${VECTOR_GROUP}`, "Contents"]);

type SettledGroupId = { readonly to: string; readonly why: string } | { readonly message: string };

function findRoot(properties: readonly PropertySnapshot[]): PropertySnapshot | undefined {
  for (const property of properties) {
    if (property.matchName === ROOT_VECTORS) return property;
    const nested = findRoot(property.children ?? []);
    if (nested) return nested;
  }
  return undefined;
}

function observedShapeGroups(layer: LayerSnapshot | undefined): number | undefined {
  const root = layer && findRoot(layer.properties);
  return root ? (root.children ?? []).filter((child) => child.matchName === VECTOR_GROUP).length : undefined;
}

function shapeIdsText(count: number | undefined): string {
  if (count === undefined) return 'the layer\'s contents are not in the snapshot, so use "root" or a create_shape_group placeholder';
  if (count === 0) return 'the layer has no shape groups yet, so use "root" or a create_shape_group placeholder';
  return `the layer's shape groups are ${Array.from({ length: count }, (_, at) => `"shape:${at + 1}"`).join(", ")}`;
}

function shapeOrdinal(groupId: string): number | undefined {
  const digits = /^shape[\s:_-]*([0-9]+)$/i.exec(groupId)?.[1];
  return digits === undefined ? undefined : Number(digits);
}

function settledOrdinal(groupId: string, ordinal: number, count: number | undefined): SettledGroupId | undefined {
  if (ordinal === 0) return { message: `groupId "${groupId}": shape ordinals count from 1 ("shape:1" is the first child of Contents); ${shapeIdsText(count)}.` };
  const canonical = `shape:${ordinal}`;
  return groupId === canonical ? undefined : { to: canonical, why: 'shape ordinals are spelled "shape:<n>"' };
}

function settledNativeName(groupId: string, count: number | undefined): SettledGroupId | undefined {
  if (!NATIVE_GROUP_NAMES.has(groupId)) return undefined;
  if (count === 1) return { to: "shape:1", why: `the layer has exactly one shape group, so "${groupId}" can only mean shape:1` };
  return { message: `groupId "${groupId}" names no single group; shape groups are addressed as "shape:<n>" counting from 1, and ${shapeIdsText(count)}.` };
}

function settledGroupId(groupId: string, count: number | undefined): SettledGroupId | undefined {
  if (groupId === ROOT_VECTORS) return { to: "root", why: `"${ROOT_VECTORS}" is the root of the layer's shape contents` };
  const ordinal = shapeOrdinal(groupId);
  return ordinal === undefined ? settledNativeName(groupId, count) : settledOrdinal(groupId, ordinal, count);
}

function correctGroupId(operation: OperationFields, context: CorrectionContext): { code: string; message: string } | undefined {
  const groupId = stringAt(operation, "groupId");
  if (groupId === undefined || groupId === "root" || groupId.startsWith("__new__:")) return undefined;
  const settled = settledGroupId(groupId, observedShapeGroups(targetLayer(context.snapshot, objectAt(operation, "target") ?? {})));
  if (!settled) return undefined;
  if ("message" in settled) return { code: "TARGET_NOT_FOUND", message: settled.message };
  recordChange(context, { field: "groupId", from: groupId, to: settled.to, why: settled.why });
  operation.groupId = settled.to;
  return undefined;
}

function declaredGroupChange(operation: OperationFields, groupId: string | undefined): OperationChange | undefined {
  if (operation.newGroupId === undefined && groupId?.startsWith("__new__:")) {
    operation.newGroupId = groupId;
    return { field: "newGroupId", from: "groupId", to: groupId, why: "create_shape_group declares its group in newGroupId; groupId names an existing group" };
  }
  if (groupId === "root" || (groupId !== undefined && groupId === operation.newGroupId)) {
    return { field: "groupId", from: groupId, to: "(removed)", why: "create_shape_group always creates its group at the root and declares it in newGroupId" };
  }
  return undefined;
}

function correctCreateShapeGroup(operation: OperationFields, context: CorrectionContext): void {
  if (operation.groupId === undefined) return;
  const change = declaredGroupChange(operation, stringAt(operation, "groupId"));
  if (!change) return;
  recordChange(context, change);
  delete operation.groupId;
}

function hoistPaintField(operation: OperationFields, values: OperationFields, key: string, context: CorrectionContext): void {
  const value = values[key];
  if (value === undefined) return;
  if (operation[key] === undefined) {
    operation[key] = value;
    recordChange(context, { field: key, from: `values.${key}`, to: value, why: `${context.type} takes ${key} at the top level, not inside values` });
  }
  if (isSameJson(operation[key], value)) delete values[key];
}

function hoistPaintValues(operation: OperationFields, context: CorrectionContext): void {
  const fields = PAINT_FIELDS[context.type];
  const values = fieldsOf(operation.values);
  if (!fields || !values) return;
  const rest = copyFields(values);
  for (const key of fields) hoistPaintField(operation, rest, key, context);
  if (Object.keys(rest).length) operation.values = rest;
  else delete operation.values;
}

/** Shape-group ids in the AE-native or ordinal vocabulary become the canonical ones, a create_shape_group declares its group in newGroupId, and paint values written inside `values` move to the top level; a group id the snapshot cannot settle is refused naming the real ids. */
export const correctShapeOperation: CorrectionStep = (operation, context) => {
  if (context.type === "create_shape_group") correctCreateShapeGroup(operation, context);
  if (context.type in PAINT_FIELDS) hoistPaintValues(operation, context);
  return GROUP_CONSUMERS.has(context.type) ? correctGroupId(operation, context) : undefined;
};

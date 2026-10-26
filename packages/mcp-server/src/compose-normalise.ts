// Lossless normalisation of two shapes that have exactly one reading, applied before an operation is composed so the
// plan that is digested, approved and applied is the normalised one:
//  - a target field written again at the top level with the identical value is redundant, and the copy is dropped;
//  - a single object wrapped around an operation's own fields (`document: { text, fontSize }`) is flattened when
//    every key inside it is a top-level field of the operation and none is already set there.
// Anything else (differing values, an unknown key in the wrapper, a collision) is left exactly as submitted so the
// validator's own refusal speaks. The allowlist is read from the validator, so no operation type is listed here.
import { acceptedFieldsOfType, nativeRoleForPath, TEXT_DOCUMENT_PATH } from "@extynt/action-plan";
import { isSameJson, recordChange, targetLayer } from "./compose-correction-core.js";
import type { CorrectionContext, CorrectionStep } from "./compose-correction-core.js";
import { arrayAt, asObject, objectAt, stringAt } from "./json.js";
import { isJsonArray } from "@extynt/decode";
import type { JsonArray, JsonObject, JsonValue } from "@extynt/decode";
import type { OperationFields } from "./operation-fields.js";

const STRUCTURAL = ["type", "target"];
const DOCUMENT_PATH_WHY = "set_text_document always writes the text document of the layer";
const SCALE_WHY = "a single number for Scale is a uniform scale, written as a vector";

function repeatedTargetKeys(operation: OperationFields, target: JsonObject): string[] {
  return Object.keys(target).filter((key) => operation[key] !== undefined && target[key] !== undefined && isSameJson(operation[key], target[key]));
}

/** A top-level copy of any target field (layer, composition, property or effect address) that the type takes only inside target, equal to the target's own, is dropped. */
export const dropRedundantTargetCopy: CorrectionStep = (operation, context) => {
  const target = objectAt(operation, "target");
  const held = target ? repeatedTargetKeys(operation, target) : [];
  if (!held.length) return undefined;
  const accepted = acceptedFieldsOfType(operation, context.snapshot);
  if (!accepted?.includes("target")) return undefined;
  for (const key of held.filter((field) => !accepted.includes(field))) {
    recordChange(context, { field: key, from: operation[key], to: "(removed)", why: "the same value was written in both places; the target copy is the one the operation reads" });
    delete operation[key];
  }
  return undefined;
};

function dropTargetDocumentPath(operation: OperationFields, target: JsonObject, context: CorrectionContext): void {
  const rest = Object.fromEntries(Object.entries(target).filter(([name]) => name !== "propertyPath"));
  recordChange(context, { field: "target.propertyPath", from: TEXT_DOCUMENT_PATH, to: "(removed)", why: DOCUMENT_PATH_WHY });
  operation.target = rest;
}

/** set_text_document addresses a text layer, never a property: the text document's own path, written at the top level or in target, names nothing more and is dropped. */
export const dropTextDocumentPath: CorrectionStep = (operation, context) => {
  if (context.type !== "set_text_document") return undefined;
  const target = objectAt(operation, "target");
  if (operation.propertyPath === TEXT_DOCUMENT_PATH) {
    recordChange(context, { field: "propertyPath", from: TEXT_DOCUMENT_PATH, to: "(removed)", why: DOCUMENT_PATH_WHY });
    delete operation.propertyPath;
  }
  if (target && target.propertyPath === TEXT_DOCUMENT_PATH) dropTargetDocumentPath(operation, target, context);
  return undefined;
};

interface Wrapper {
  readonly name: string;
  readonly inner: JsonObject;
}

function strayWrapper(operation: OperationFields, accepted: readonly string[]): Wrapper | undefined {
  const strays = Object.keys(operation).filter((key) => !accepted.includes(key));
  const name = strays.length === 1 ? strays[0] : undefined;
  const inner = name === undefined ? undefined : objectAt(operation, name);
  return name !== undefined && inner ? { name, inner } : undefined;
}

function isFlattenable(operation: OperationFields, keys: readonly string[], accepted: readonly string[]): boolean {
  return keys.length > 0 && keys.every((key) => accepted.includes(key) && !STRUCTURAL.includes(key) && operation[key] === undefined);
}

/** The one stray field of an operation, when it is an object whose keys the operation takes at the top level and does not yet hold. */
export const flattenWrapper: CorrectionStep = (operation, context) => {
  const accepted = acceptedFieldsOfType(operation, context.snapshot);
  const wrapper = accepted ? strayWrapper(operation, accepted) : undefined;
  if (!accepted || !wrapper) return undefined;
  const keys = Object.keys(wrapper.inner);
  if (!isFlattenable(operation, keys, accepted)) return undefined;
  delete operation[wrapper.name];
  for (const [key, value] of Object.entries(wrapper.inner)) {
    operation[key] = value;
    recordChange(context, { field: key, from: `${wrapper.name}.${key}`, to: value, why: `${context.type} takes ${key} at the top level, not inside ${wrapper.name}` });
  }
  return undefined;
};

function documentTextFor(sibling: JsonValue, layerId: string): string | undefined {
  const fields = asObject(sibling);
  const isDocumentOfLayer = fields?.type === "set_text_document" && stringAt(objectAt(fields, "target"), "layerId") === layerId;
  return isDocumentOfLayer ? stringAt(fields, "text") : undefined;
}

function textFromSiblings(call: JsonArray, layerId: string): string | undefined {
  for (const sibling of call) {
    const text = documentTextFor(sibling, layerId);
    if (text !== undefined) return text;
  }
  return undefined;
}

/** The text a create_layer text layer lacks, when a set_text_document on the same target in the same call carries it; that operation is left as it is. */
export const takeTextFromDocument: CorrectionStep = (operation, context) => {
  const layerId = stringAt(objectAt(operation, "target"), "layerId");
  if (context.type !== "create_layer" || operation.layerType !== "text" || operation.text !== undefined || layerId === undefined) return undefined;
  const text = textFromSiblings(context.call ?? [], layerId);
  if (text === undefined) return undefined;
  operation.text = text;
  recordChange(context, { field: "text", from: "(missing)", to: text, why: "a text layer is created with its text; the same call's set_text_document for this layer carries it" });
  return undefined;
};

function scaleDimension(operation: OperationFields, values: JsonArray, context: CorrectionContext): number {
  const target = objectAt(operation, "target");
  if (target && targetLayer(context.snapshot, target)?.threeD === true) return 3;
  return values.some((value) => isJsonArray(value) && value.length === 3) ? 3 : 2;
}

function uniformVector(value: number, size: number): JsonValue {
  return Number.isFinite(value) ? Array.from({ length: size }, () => value) : value;
}

function expandKeyframeScales(operation: OperationFields, context: CorrectionContext): void {
  const keyframes = arrayAt(operation, "keyframes");
  if (!keyframes?.some((keyframe) => typeof asObject(keyframe)?.value === "number")) return;
  const size = scaleDimension(operation, keyframes.map((keyframe) => asObject(keyframe)?.value ?? null), context);
  operation.keyframes = keyframes.map((keyframe, position) => {
    const fields = asObject(keyframe);
    const scale = fields?.value;
    if (!fields || typeof scale !== "number") return keyframe;
    const value = uniformVector(scale, size);
    recordChange(context, { field: `keyframes[${position}].value`, from: scale, to: value, why: SCALE_WHY });
    return { ...fields, value };
  });
}

function expandPlainScale(operation: OperationFields, context: CorrectionContext): void {
  const scale = operation.value;
  if (context.type !== "set_layer_property" || typeof scale !== "number") return;
  const value = uniformVector(scale, scaleDimension(operation, [], context));
  recordChange(context, { field: "value", from: scale, to: value, why: SCALE_WHY });
  operation.value = value;
}

function isScaleWrite(operation: OperationFields): boolean {
  const path = stringAt(objectAt(operation, "target"), "propertyPath") ?? stringAt(operation, "propertyPath");
  return (nativeRoleForPath(path) ?? stringAt(operation, "role")) === "transform.scale";
}

/** A single number written for Scale means uniform scale: s becomes [s, s] ([s, s, s] on a 3D layer). Position, anchor and every other property are never expanded. */
export const expandUniformScale: CorrectionStep = (operation, context) => {
  if (!isScaleWrite(operation)) return undefined;
  expandKeyframeScales(operation, context);
  expandPlainScale(operation, context);
  return undefined;
};

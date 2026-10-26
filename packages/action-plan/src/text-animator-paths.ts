// Which text animator property paths an earlier operation in the plan materialises, with the ordinal bookkeeping After Effects uses:
// the first animator is "ADBE Text Animator", later ones "ADBE Text Animator#2", "#3", and so on.
import { flattenProperties, type ProjectSnapshot } from "@extynt/project-graph";
import { type JsonObject, type JsonValue } from "@extynt/decode";
import { TEXT_ANIMATOR_PROPERTIES, TEXT_SELECTORS } from "./extended.js";
import { isJsonObject } from "./json-shape.js";
import { observedLayer, operationTargetsLayer } from "./layer-targets.js";
import type { V2TargetReference } from "./plan-types.js";

const TEXT_ANIMATORS_PATH = "ADBE Text Properties/ADBE Text Animators";
const TEXT_ANIMATOR_SELECTORS_SEGMENT = "ADBE Text Selectors";
const TEXT_ANIMATOR_PROPERTIES_SEGMENT = "ADBE Text Animator Properties";
const TEXT_SELECTOR_PERCENT_LEAVES = ["ADBE Text Percent Start", "ADBE Text Percent End", "ADBE Text Percent Offset"];
const ANIMATOR_SEGMENT = /^ADBE Text Animator(#\d+)?$/;
const ANIMATOR_PLACEHOLDER = /^animator:[1-9][0-9]{0,2}$/;

const TEXT_ANIMATOR_PROPERTY_PATHS: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(TEXT_ANIMATOR_PROPERTIES).map(([key, spec]) => [key, spec.path]));
const TEXT_SELECTOR_MATCH_NAMES: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(TEXT_SELECTORS).map(([key, spec]) => [key, spec.matchName]));
const TEXT_SELECTOR_SETTING_PATHS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.fromEntries(Object.entries(TEXT_SELECTORS).map(([key, spec]) => [key, Object.fromEntries(Object.entries(spec.settings).map(([setting, value]) => [setting, value.path]))]));

type AnimatorCursor = { count: number; readonly placeholders: Map<string, number> };

/** True when an earlier add/update/ensure_text_animator in this plan materialises this exact property path. */
export function hasPlannedAnimatorProperty(operations: readonly JsonValue[], snapshot: ProjectSnapshot | undefined, target: V2TargetReference, propertyPath: string | undefined): boolean {
  if (!propertyPath) return false;
  const cursor: AnimatorCursor = { count: observedAnimatorCount(snapshot, target), placeholders: new Map<string, number>() };
  return operations.some((value) => isJsonObject(value) && operationTargetsLayer(value, target) && animatorOperationDeclares(cursor, value, propertyPath));
}

function textAnimatorPrefix(ordinal: number): string { return `${TEXT_ANIMATORS_PATH}/${ordinal <= 1 ? "ADBE Text Animator" : `ADBE Text Animator#${ordinal}`}`; }

function observedAnimatorCount(snapshot: ProjectSnapshot | undefined, target: V2TargetReference): number {
  const layer = observedLayer(snapshot, target);
  if (!layer) return 0;
  const seen = new Set<string>();
  for (const property of flattenProperties(layer.properties)) {
    if (!property.path.startsWith(`${TEXT_ANIMATORS_PATH}/`)) continue;
    const segment = property.path.slice(TEXT_ANIMATORS_PATH.length + 1).split("/")[0];
    if (segment && ANIMATOR_SEGMENT.test(segment)) seen.add(segment);
  }
  return seen.size;
}

function animatorDeclaresPath(operation: JsonObject, ordinal: number, propertyPath: string): boolean {
  const prefix = textAnimatorPrefix(ordinal);
  if (operation.type === "ensure_text_animator") return ensureAnimatorDeclaresPath(operation, prefix, propertyPath);
  const declaresProperty = animatorDeclaredKeys(operation).some((key) => !key.startsWith("selector.") && propertyPathOf(key, prefix) === propertyPath);
  return declaresProperty || selectorDeclaresPath(operation, prefix, propertyPath);
}

function propertyPathOf(key: string, prefix: string): string | undefined {
  const relative = TEXT_ANIMATOR_PROPERTY_PATHS[key];
  return relative ? `${prefix}/${relative}` : undefined;
}

function animatorDeclaredKeys(operation: JsonObject): string[] {
  const properties = operation.properties;
  const keyframes = operation.keyframes;
  return [...Object.keys(isJsonObject(properties) ? properties : {}), ...Object.keys(isJsonObject(keyframes) ? keyframes : {})];
}

function ensureAnimatorDeclaresPath(operation: JsonObject, prefix: string, propertyPath: string): boolean {
  if (operation.role === "text.opacity" && propertyPath === `${prefix}/${TEXT_ANIMATOR_PROPERTIES_SEGMENT}/ADBE Text Opacity`) return true;
  return TEXT_SELECTOR_PERCENT_LEAVES.some((leaf) => propertyPath === `${prefix}/${TEXT_ANIMATOR_SELECTORS_SEGMENT}/ADBE Text Selector/${leaf}`);
}

function selectorDeclaresPath(operation: JsonObject, prefix: string, propertyPath: string): boolean {
  const selector = operation.selector;
  const selectorObject = isJsonObject(selector) ? selector : undefined;
  const settings = selectorObject?.settings;
  const selectorType = selectorObject?.type;
  const typeName = typeof selectorType === "string" ? selectorType : "range";
  const matchName = TEXT_SELECTOR_MATCH_NAMES[typeName];
  const relativeSettings = TEXT_SELECTOR_SETTING_PATHS[typeName];
  if (!matchName || !relativeSettings) return false;
  return Object.keys(isJsonObject(settings) ? settings : {}).some((key) => relativeSettings[key] !== undefined && propertyPath === `${prefix}/${TEXT_ANIMATOR_SELECTORS_SEGMENT}/${matchName}/${relativeSettings[key]}`);
}

function animatorOperationDeclares(cursor: AnimatorCursor, operation: JsonObject, propertyPath: string): boolean {
  const type = operation.type;
  if (type === "ensure_text_animator") return ensureAnimatorDeclares(cursor, operation, propertyPath);
  if (type === "add_text_animator") return addAnimatorDeclares(cursor, operation, propertyPath);
  return type === "update_text_animator" && updateAnimatorDeclares(cursor, operation, propertyPath);
}

function ensureAnimatorDeclares(cursor: AnimatorCursor, operation: JsonObject, propertyPath: string): boolean {
  if (cursor.count === 0) cursor.count = 1;
  return animatorDeclaresPath(operation, 1, propertyPath);
}

function addAnimatorDeclares(cursor: AnimatorCursor, operation: JsonObject, propertyPath: string): boolean {
  cursor.count += 1;
  const ordinal = cursor.count;
  const newAnimatorId = operation.newAnimatorId;
  if (typeof newAnimatorId === "string") cursor.placeholders.set(newAnimatorId, ordinal);
  return animatorDeclaresPath(operation, ordinal, propertyPath);
}

function updateAnimatorDeclares(cursor: AnimatorCursor, operation: JsonObject, propertyPath: string): boolean {
  const ordinal = animatorOrdinal(cursor, operation.animatorId);
  return ordinal !== undefined && ordinal <= cursor.count && animatorDeclaresPath(operation, ordinal, propertyPath);
}

function animatorOrdinal(cursor: AnimatorCursor, animatorId: JsonValue | undefined): number | undefined {
  if (typeof animatorId !== "string") return undefined;
  if (ANIMATOR_PLACEHOLDER.test(animatorId)) return Number(animatorId.slice("animator:".length));
  return cursor.placeholders.get(animatorId);
}

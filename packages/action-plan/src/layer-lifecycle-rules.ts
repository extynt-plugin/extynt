// The property, name, parenting, attribute, creation, timing, loop, audio and time-remap rules for a layer-grounded operation.
import { textFieldError } from "@extynt/project-graph";
import { isJsonArray, type JsonObject, type JsonValue } from "@extynt/decode";
import { LOOP_MODES } from "./canonical-enums.js";
import { ALL_BLEND_MODES, LAYER_SWITCHES } from "./extended.js";
import { hasBareLayerTarget, hasPlannedLayer, observedLayerExists, operationPropertyPath, operationTargetsLayer, type GroundedContext } from "./layer-targets.js";
import { TEXT_JUSTIFICATIONS } from "./plan-constants.js";
import type { CreatableLayerType } from "./plan-types.js";
import { NATIVE_PROPERTY_ROLES, animatesProperty, isAllowlistedNativeProperty, nativeValueError, observedProperty, parentCycle, resolveNativeVectorValue, type ObservedProperty } from "./property-rules.js";
import { ACCEPTED, invalid, isBoundedName, isFiniteInRange, isFiniteJson, isIntegerInRange, isNewPlaceholderId, isOneOf, isOptionalBoolean, isOptionalLayerId, objectsIn, rejectUnknown, type OperationResult, type Refusal } from "./validation-primitives.js";

type Field = JsonValue | undefined;
type LayerSwitchRole = keyof typeof LAYER_SWITCHES;
type NativePropertyFields = { readonly role: string; readonly propertyPath: string; readonly value: JsonValue };

const BOOLEAN_LAYER_ATTRIBUTES: readonly string[] = ["three-d", "shy", "solo", "enabled", "locked"];
const CREATABLE_LAYER_TYPES: readonly CreatableLayerType[] = ["text", "shape", "null", "camera", "light", "adjustment", "solid", "footage"];
const CREATED_ITEM_ID_FIELDS: ReadonlyMap<string, string> = new Map([["import_file", "newItemId"], ["create_vector_artwork", "newItemId"], ["create_composition", "newCompositionId"], ["duplicate_composition", "newCompositionId"], ["precompose_layers", "newCompositionId"]]);
const TIMING_KEYS = ["inPoint", "outPoint", "startTime"] as const;
const MAX_TIMING_SECONDS = 86_400;
const MAX_TEXT_LENGTH = 4096;

function nativePropertyFields(operation: JsonObject): NativePropertyFields | undefined {
  const { role, propertyPath, value } = operation;
  return typeof role === "string" && role && typeof propertyPath === "string" && propertyPath && isFiniteJson(value) ? { role, propertyPath, value } : undefined;
}

function staticWriteConflictError(context: GroundedContext, propertyPath: string, observed: ObservedProperty | undefined): Refusal | undefined {
  const { target, earlier } = context;
  if (!observed || typeof observed.keyframeCount !== "number" || observed.keyframeCount <= 0 || earlier.some((planned) => animatesProperty(planned, target, propertyPath))) return undefined;
  return invalid("CONFLICTING_KEYS", `${propertyPath} has ${observed.keyframeCount} keyframe(s); After Effects refuses a static value there. Use animate_property with keyframeMode merge or replace.`);
}

function unresolvedNullComponentError(context: GroundedContext, fields: NativePropertyFields, observed: ObservedProperty | undefined): Refusal | undefined {
  const { snapshot } = context;
  const { role, value } = fields;
  if (!snapshot || !Array.isArray(value) || !value.includes(null)) return undefined;
  const resolution = resolveNativeVectorValue(role, value, observed?.value);
  return resolution.ok ? undefined : invalid("INVALID_VALUE", `set_layer_property ${resolution.message}`);
}

/** set_layer_property: a static value for one native transform property. A component given as null keeps what that component has, resolved against the snapshot here and again when the host command is built, so an unfillable null is refused while the agent still holds the plan. */
export function validateSetLayerProperty(context: GroundedContext): OperationResult {
  const { operation, target, snapshot } = context;
  const refused = rejectUnknown(operation, ["type", "target", "role", "propertyPath", "value"]);
  if (refused) return refused;
  const fields = nativePropertyFields(operation);
  if (!fields) return invalid("INVALID_OPERATION", `set_layer_property requires top-level role, propertyPath, and value, with target {compositionId, layerId}. Roles: ${NATIVE_PROPERTY_ROLES}. Example: {"type":"set_layer_property","target":{"compositionId":"C","layerId":"L"},"role":"transform.opacity","propertyPath":"ADBE Transform Group/ADBE Opacity","value":50}.`);
  if (target.effectPath !== undefined || !isAllowlistedNativeProperty(fields.propertyPath, fields.role)) return invalid("INVALID_TARGET", `set_layer_property is limited to these role → propertyPath pairs: ${NATIVE_PROPERTY_ROLES}; target must not carry effectPath. For effect controls use set_effect_control.`);
  const nativeError = nativeValueError(fields.role, fields.value, true);
  if (nativeError) return invalid("INVALID_VALUE", `set_layer_property ${nativeError}`);
  const observed = observedProperty(snapshot, { ...target, propertyPath: fields.propertyPath });
  return staticWriteConflictError(context, fields.propertyPath, observed) ?? unresolvedNullComponentError(context, fields, observed) ?? ACCEPTED;
}

/** set_layer_name: a bounded 1-256 character name on a layer. */
export function validateSetLayerName(context: GroundedContext): OperationResult {
  const { operation, target } = context;
  const refused = rejectUnknown(operation, ["type", "target", "name"]);
  if (refused) return refused;
  if (!hasBareLayerTarget(target) || !isBoundedName(operation.name, 256)) return invalid("INVALID_OPERATION", "set_layer_name requires a bounded 1-256 character name and no effect/property target.");
  return ACCEPTED;
}

function parentLayerMissingError(context: GroundedContext, parentLayerId: string | null | undefined): Refusal | undefined {
  const { target, snapshot, earlier } = context;
  if (!snapshot || parentLayerId === null) return undefined;
  const reference = typeof parentLayerId === "string" ? { ...target, layerId: parentLayerId } : undefined;
  const present = reference !== undefined && (observedLayerExists(snapshot, reference) || hasPlannedLayer(earlier, reference));
  return present ? undefined : invalid("TARGET_NOT_FOUND", "The parent layer is not present in the current snapshot or an earlier create_layer operation in this plan.");
}

function parentCycleError(context: GroundedContext, parentLayerId: string | null | undefined): Refusal | undefined {
  const { target, snapshot, earlier } = context;
  if (typeof parentLayerId !== "string") return undefined;
  const cycle = parentCycle(snapshot, earlier, target, parentLayerId);
  return cycle ? invalid("PARENT_CYCLE", `Parenting ${target.layerId} to ${parentLayerId} would create a cycle (${cycle.join(" → ")}). Clear or change the existing parent first.`) : undefined;
}

/** set_layer_parent: a parent layer that exists in the snapshot or an earlier create_layer, or null to clear the parent, never closing a parent cycle. */
export function validateSetLayerParent(context: GroundedContext): OperationResult {
  const { operation, target } = context;
  const refused = rejectUnknown(operation, ["type", "target", "parentLayerId"]);
  if (refused) return refused;
  const parentLayerId = operation.parentLayerId;
  if (!hasBareLayerTarget(target) || !isOptionalLayerId(parentLayerId)) return invalid("INVALID_OPERATION", "set_layer_parent requires a parent layer id or null to clear the parent.");
  if (parentLayerId === target.layerId) return invalid("INVALID_VALUE", "A layer cannot be parented to itself.");
  return parentLayerMissingError(context, parentLayerId) ?? parentCycleError(context, parentLayerId) ?? ACCEPTED;
}

function isLayerSwitchRole(value: Field): value is LayerSwitchRole { return typeof value === "string" && Object.hasOwn(LAYER_SWITCHES, value); }

function booleanAttributeResult(role: string, value: Field): OperationResult {
  return typeof value === "boolean" ? ACCEPTED : invalid("INVALID_VALUE", `${role} requires a boolean value.`);
}

function blendModeResult(value: Field): OperationResult {
  return isOneOf(value, ALL_BLEND_MODES) ? ACCEPTED : invalid("INVALID_VALUE", `blend-mode must be one of ${ALL_BLEND_MODES.join(", ")}.`);
}

function layerSwitchResult(role: LayerSwitchRole, value: Field): OperationResult {
  const spec = LAYER_SWITCHES[role];
  if (spec.kind === "boolean") return booleanAttributeResult(role, value);
  if (spec.kind === "enum") return isOneOf(value, spec.values) ? ACCEPTED : invalid("INVALID_VALUE", `${role} requires one of ${spec.values.join(", ")}.`);
  return isIntegerInRange(value, spec.min, spec.max) ? ACCEPTED : invalid("INVALID_VALUE", `${role} requires an integer ${spec.min}-${spec.max}.`);
}

/** set_layer_attribute: the blend mode, a boolean layer switch, or one of the extra layer switches, each checked against its own value kind. */
export function validateSetLayerAttribute(context: GroundedContext): OperationResult {
  const { operation, target } = context;
  const refused = rejectUnknown(operation, ["type", "target", "role", "value"]);
  if (refused) return refused;
  if (!hasBareLayerTarget(target)) return invalid("INVALID_TARGET", "set_layer_attribute does not use an effect or property target.");
  const { role, value } = operation;
  if (role === "blend-mode") return blendModeResult(value);
  if (isLayerSwitchRole(role)) return layerSwitchResult(role, value);
  if (typeof role === "string" && BOOLEAN_LAYER_ATTRIBUTES.includes(role)) return booleanAttributeResult(role, value);
  return invalid("INVALID_OPERATION", "set_layer_attribute role is not recognized.");
}

function isCreatableLayerType(value: Field): value is CreatableLayerType { return isOneOf(value, CREATABLE_LAYER_TYPES); }

function isLayerColor(value: Field, layerType: Field): boolean {
  if (!isJsonArray(value)) return false;
  if (value.length !== 4 && !(layerType === "solid" && value.length === 3)) return false;
  return value.every((channel) => isFiniteInRange(channel, 0, 1));
}

function createLayerShapeError(operation: JsonObject, target: GroundedContext["target"]): Refusal | undefined {
  const valid = isNewPlaceholderId(target.layerId) && hasBareLayerTarget(target) && isCreatableLayerType(operation.layerType) && isBoundedName(operation.name, 256);
  return valid ? undefined : invalid("INVALID_OPERATION", "create_layer requires a bounded new-layer target, supported layer type, and name.");
}

function layerSizeError(operation: JsonObject): Refusal | undefined {
  const size = operation.size;
  if (size === undefined) return undefined;
  if (operation.layerType !== "solid" || !isJsonArray(size) || size.length !== 2 || size.some((dimension) => !isIntegerInRange(dimension, 1, 30_000))) return invalid("INVALID_VALUE", "size applies only to solids and must be [width, height] integers 1-30000.");
  return undefined;
}

function producesProjectItem(planned: JsonObject, id: string): boolean {
  const field = CREATED_ITEM_ID_FIELDS.get(String(planned.type));
  return field !== undefined && planned[field] === id;
}

function sourceObserved(snapshot: GroundedContext["snapshot"], sourceId: string): boolean {
  if (!snapshot) return true;
  return (snapshot.items ?? []).some((item) => item.id === sourceId && item.type !== "folder") || snapshot.compositions.some((composition) => composition.id === sourceId);
}

function footageSourceError(context: GroundedContext): Refusal | undefined {
  const { operation, target, snapshot, earlier } = context;
  const sourceItemId = operation.sourceItemId;
  const isFootage = operation.layerType === "footage";
  if (isFootage !== (sourceItemId !== undefined)) return invalid("INVALID_VALUE", "footage layers require sourceItemId (and only footage layers accept it).");
  if (!isFootage) return undefined;
  const source = String(sourceItemId);
  if (source === target.compositionId) return invalid("INVALID_VALUE", "A composition cannot be added to itself.");
  const planned = objectsIn(earlier).some((operationBefore) => producesProjectItem(operationBefore, source));
  return planned || sourceObserved(snapshot, source) ? undefined : invalid("TARGET_NOT_FOUND", "sourceItemId must be a footage or composition item in the snapshot or imported/created earlier in this plan.");
}

function textOnlyFieldsError(operation: JsonObject): Refusal | undefined {
  const textOnly = ["box", "vertical", "justification"].some((key) => operation[key] !== undefined);
  return textOnly && operation.layerType !== "text" ? invalid("INVALID_VALUE", "box, vertical and justification apply only to text layers.") : undefined;
}

function justificationError(justification: Field): Refusal | undefined {
  return justification === undefined || isOneOf(justification, TEXT_JUSTIFICATIONS) ? undefined : invalid("INVALID_VALUE", `justification requires one of ${TEXT_JUSTIFICATIONS.join(", ")}.`);
}

function boxSizeError(box: Field): Refusal | undefined {
  if (box === undefined) return undefined;
  const error = textFieldError("boxTextSize", box);
  return error ? invalid("INVALID_VALUE", `box: ${error}`) : undefined;
}

function verticalError(vertical: Field): Refusal | undefined {
  return vertical === undefined || typeof vertical === "boolean" ? undefined : invalid("INVALID_VALUE", "vertical must be boolean.");
}

function textLayerShapeError(operation: JsonObject): Refusal | undefined {
  return textOnlyFieldsError(operation) ?? justificationError(operation.justification) ?? boxSizeError(operation.box) ?? verticalError(operation.vertical);
}

function layerContentError(operation: JsonObject): Refusal | undefined {
  const { text, color } = operation;
  if (text !== undefined && (typeof text !== "string" || text.length > MAX_TEXT_LENGTH)) return invalid("INVALID_VALUE", "Text content must be at most 4096 characters.");
  if (color !== undefined && !isLayerColor(color, operation.layerType)) return invalid("INVALID_VALUE", "Layer colors must contain four normalized channels.");
  return operation.layerType === "text" && text === undefined ? invalid("INVALID_VALUE", "Text layers require text content.") : undefined;
}

/** create_layer: a new-layer placeholder target with a supported layer type and name; solids take a size, footage layers take a source item, and text layers take their text. */
export function validateCreateLayer(context: GroundedContext): OperationResult {
  const { operation, target } = context;
  const refused = rejectUnknown(operation, ["type", "target", "layerType", "name", "text", "color", "box", "vertical", "justification", "size", "sourceItemId"]);
  if (refused) return refused;
  return layerSizeError(operation) ?? footageSourceError(context) ?? textLayerShapeError(operation) ?? createLayerShapeError(operation, target) ?? layerContentError(operation) ?? ACCEPTED;
}

function numberOrUndefined(value: Field): number | undefined { return typeof value === "number" ? value : undefined; }

function hasFiniteTiming(operation: JsonObject): boolean {
  const given = TIMING_KEYS.map((key) => operation[key]).filter((value) => value !== undefined);
  return given.length > 0 && given.every((value) => isFiniteInRange(value, -MAX_TIMING_SECONDS, MAX_TIMING_SECONDS));
}

function isOrderedTiming(inPoint: number | undefined, outPoint: number | undefined): boolean {
  if (inPoint !== undefined && inPoint < 0) return false;
  if (outPoint !== undefined && outPoint < 0) return false;
  return !(inPoint !== undefined && outPoint !== undefined && outPoint <= inPoint);
}

/** set_layer_timing: finite bounded in, out and start times with a non-negative in point before the out point, and an optional stretch percentage. */
export function validateSetLayerTiming(context: GroundedContext): OperationResult {
  const { operation, target } = context;
  const refused = rejectUnknown(operation, ["type", "target", "inPoint", "outPoint", "startTime", "stretch"]);
  if (refused) return refused;
  if (operation.stretch !== undefined && !isFiniteInRange(operation.stretch, 1, 10_000)) return invalid("INVALID_VALUE", "stretch must be a percentage from 1 to 10000 (100 is normal speed).");
  if (!hasBareLayerTarget(target) || (!hasFiniteTiming(operation) && operation.stretch === undefined)) return invalid("INVALID_OPERATION", "set_layer_timing requires one or more finite bounded timing values.");
  if (!isOrderedTiming(numberOrUndefined(operation.inPoint), numberOrUndefined(operation.outPoint))) return invalid("INVALID_VALUE", "Layer timing must be non-negative and outPoint must be after inPoint.");
  return ACCEPTED;
}

function loopDirectionError(direction: Field): Refusal | undefined {
  if (direction === undefined || direction === "out" || direction === "in") return undefined;
  return invalid("INVALID_VALUE", "direction must be out (after the last key) or in (before the first key).");
}

function loopCountError(operation: JsonObject): Refusal | undefined {
  const count = operation.count;
  if (count === undefined) return undefined;
  if (operation.mode === "continue" || !isIntegerInRange(count, 0, 1000)) return invalid("INVALID_VALUE", "count is an integer 0-1000 (0 loops every key) and does not apply to continue.");
  return undefined;
}

function hasPlannedLoopKeys(operations: readonly JsonValue[], target: GroundedContext["target"]): boolean {
  return objectsIn(operations).some((planned) => {
    const animates = planned.type === "animate_property" || planned.type === "animate_control";
    const keyframes = planned.keyframes;
    return animates && operationTargetsLayer(planned, target) && operationPropertyPath(planned) === target.propertyPath && Array.isArray(keyframes) && keyframes.length >= 2;
  });
}

function loopKeyframesError(context: GroundedContext): Refusal | undefined {
  const { target, snapshot, earlier } = context;
  if (!snapshot) return undefined;
  if (hasPlannedLoopKeys(earlier, target) || (observedProperty(snapshot, target)?.keyframeCount ?? 0) >= 2) return undefined;
  return invalid("LOOP_REQUIRES_KEYFRAMES", "set_loop needs a property with at least two keyframes in the snapshot or animated earlier in this plan.");
}

/** set_loop: a loop mode on one exact keyframed property, refused here when the property lacks two keyframes so the failure comes before approval. */
export function validateSetLoop(context: GroundedContext): OperationResult {
  const { operation, target } = context;
  const refused = rejectUnknown(operation, ["type", "target", "mode", "count", "direction"]);
  if (refused) return refused;
  if (!target.propertyPath) return invalid("INVALID_TARGET", "set_loop requires the exact keyframed propertyPath.");
  if (!isOneOf(operation.mode, LOOP_MODES)) return invalid("INVALID_VALUE", "mode must be cycle, pingpong, offset, or continue.");
  return loopDirectionError(operation.direction) ?? loopCountError(operation) ?? loopKeyframesError(context) ?? ACCEPTED;
}

/** set_audio: an enabled flag, a level in decibels from -96 to 12, or both. */
export function validateSetAudio(context: GroundedContext): OperationResult {
  const { operation, target } = context;
  const refused = rejectUnknown(operation, ["type", "target", "enabled", "levelDb"]);
  if (refused) return refused;
  const levelDb = operation.levelDb;
  if (!hasBareLayerTarget(target) || !isOptionalBoolean(operation.enabled) || (levelDb !== undefined && !isFiniteInRange(levelDb, -96, 12))) return invalid("INVALID_OPERATION", "set_audio requires bounded enabled and level values.");
  if (operation.enabled === undefined && levelDb === undefined) return invalid("INVALID_OPERATION", "set_audio requires enabled or levelDb.");
  return ACCEPTED;
}

/** set_time_remap: switches time remapping on or off for one layer. */
export function validateSetTimeRemap(context: GroundedContext): OperationResult {
  const { operation, target } = context;
  const refused = rejectUnknown(operation, ["type", "target", "enabled"]);
  if (refused) return refused;
  if (!hasBareLayerTarget(target) || typeof operation.enabled !== "boolean") return invalid("INVALID_OPERATION", "set_time_remap requires an exact layer target and boolean enabled state.");
  return ACCEPTED;
}

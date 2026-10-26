// The effect, layer-style, preset, text-animator and text-document rules for a layer-grounded operation: each validator owns one kind's fields.
import { TEXT_DOCUMENT_FIELDS, TEXT_RANGE_MAX, textFieldError } from "@extynt/project-graph";
import { type JsonObject, type JsonValue, isJsonArray } from "@extynt/decode";
import { EFFECT_PARADE_PREFIX, effectPathNamesMatchName, ordinalInMatchName } from "./effect-paths.js";
import { isJsonObject } from "./json-shape.js";
import { hasBareLayerTarget, hasPlannedEffect, observedLayer, type GroundedContext } from "./layer-targets.js";
import { LAYER_STYLES, LAYER_STYLE_MAX_VALUES, PRESET_ID_PATTERN, TEXT_DOCUMENT_PATH, layerStylePath } from "./plan-constants.js";
import type { V2TargetReference } from "./plan-types.js";
import { isHostResolvablePath, observedProperty, propertyMatchesTarget, type ObservedProperty } from "./property-rules.js";
import { ACCEPTED, invalid, isFiniteInRange, isNonEmptyString, isNonNegativeFinite, isOptionalBoolean, isPrefixedPath, isStaticControlValue, rejectUnknown, type OperationResult, type Refusal } from "./validation-primitives.js";

type Field = JsonValue | undefined;
type LayerStyleName = keyof typeof LAYER_STYLES;

const PRESET_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,80}(?:\/[A-Za-z0-9][A-Za-z0-9 ._-]{0,80}){0,2}\.ffx$/i;
const GAUSSIAN_BLUR_MATCH_NAME = "ADBE Gaussian Blur 2";
const MAX_CHARACTER_RANGE_END = 4096;
const BOX_ONLY_FIELDS: readonly string[] = Object.entries(TEXT_DOCUMENT_FIELDS).filter(([, spec]) => spec.scope === "box").map(([name]) => name);
const TEXT_FIELD_NAMES: readonly string[] = Object.keys(TEXT_DOCUMENT_FIELDS);

function isEffectCapabilityId(capabilityId: Field, effectMatchName: Field): boolean {
  return typeof capabilityId === "string" && (capabilityId.startsWith("adobe.") || capabilityId === `host:${String(effectMatchName)}`);
}

function ordinalRefusal(kind: string, effectMatchName: string): Refusal {
  return invalid("INVALID_OPERATION", `${kind} effectMatchName "${effectMatchName}" carries an instance ordinal; effectMatchName is the bare matchName and only effectPath carries "#N" (effectMatchName "ADBE Glo2", effectPath "ADBE Effect Parade/ADBE Glo2#2" for a second Glow).`);
}

function effectIdentityError(kind: string, effectPath: string, effectMatchName: string): Refusal | undefined {
  if (ordinalInMatchName(effectPath, effectMatchName)) return ordinalRefusal(kind, effectMatchName);
  if (!effectPathNamesMatchName(effectPath, effectMatchName)) return invalid("INVALID_OPERATION", `${kind} effectPath must name effectMatchName "${effectMatchName}"; the host escapes "/", "#" and "%" inside a matchName and appends "#N" for a second instance of the same effect.`);
  return undefined;
}

function ensureEffectIdentity(operation: JsonObject): { readonly effectMatchName: string; readonly effectPath: string } | undefined {
  const { capabilityId, effectMatchName, effectPath } = operation;
  const valid = typeof capabilityId === "string" && isEffectCapabilityId(capabilityId, effectMatchName) && isNonEmptyString(effectMatchName) && isPrefixedPath(effectPath, EFFECT_PARADE_PREFIX) && isOptionalBoolean(operation.enabled);
  return valid ? { effectMatchName, effectPath } : undefined;
}

function isGaussianDimension(value: Field): boolean { return value === 1 || value === 2 || value === 3; }

function validGaussianControls(init: JsonObject): boolean {
  return Object.keys(init).length === 3 && isNonNegativeFinite(init.blurriness) && isGaussianDimension(init.dimensions) && typeof init.repeatEdgePixels === "boolean";
}

function validGaussianInitialization(matchName: string, enabled: Field, init: Field): boolean {
  return matchName === GAUSSIAN_BLUR_MATCH_NAME && typeof enabled === "boolean" && isJsonObject(init) && validGaussianControls(init);
}

function ensureInitializationError(context: GroundedContext, effectMatchName: string): Refusal | undefined {
  const { operation, snapshot } = context;
  if (operation.initialization === undefined) return undefined;
  if (!validGaussianInitialization(effectMatchName, operation.enabled, operation.initialization)) return invalid("INVALID_VALUE", "Explicit Gaussian initialization requires enabled, finite nonnegative blurriness, dimensions 1 (Horizontal and Vertical), 2 (Horizontal) or 3 (Vertical), and repeatEdgePixels boolean. No defaults are inferred.");
  if (snapshot?.coverage?.kind === "composition-metadata") return undefined;
  return invalid("READ_SET_UNSUPPORTED", "Explicit creation requires a scoped effect-creation demand; legacy ensure semantics do not accept initialization. Drop initialization and set each value with set_effect_control on the same effectPath later in this plan (Blurriness is ADBE Gaussian Blur 2-0001).");
}

/** ensure_effect: a curated adobe.* capability or host:<matchName>, an effect path that names the matchName, and a target effectPath equal to it; a mismatched path is refused here because the host would only fail after approval. */
export function validateEnsureEffect(context: GroundedContext): OperationResult {
  const { operation, target } = context;
  const refused = rejectUnknown(operation, ["type", "target", "capabilityId", "effectMatchName", "effectPath", "enabled", "initialization"]);
  if (refused) return refused;
  const identity = ensureEffectIdentity(operation);
  if (!identity) return invalid("INVALID_OPERATION", "ensure_effect requires a curated adobe.* capability or host:<effectMatchName>, a non-empty effect matchName, an effect path naming that effect, and a boolean enabled flag.");
  const identityRefusal = ensureInitializationError(context, identity.effectMatchName) ?? effectIdentityError("ensure_effect", identity.effectPath, identity.effectMatchName);
  if (identityRefusal) return identityRefusal;
  return target.effectPath === identity.effectPath ? ACCEPTED : invalid("INVALID_TARGET", "The target effectPath must equal the operation's resolved effectPath.");
}

function presetFileResult(operation: JsonObject): OperationResult {
  if (operation.presetId !== undefined) return invalid("INVALID_VALUE", "apply_preset takes presetId or presetFile, not both.");
  const presetFile = operation.presetFile;
  if (typeof presetFile !== "string" || !PRESET_FILE_PATTERN.test(presetFile) || presetFile.includes("..")) return invalid("INVALID_VALUE", "presetFile is a .ffx name relative to the extynt host library (for example \"presets/Wiggle.ffx\"), at most three segments, with no \"..\" and no absolute path.");
  return ACCEPTED;
}

/** apply_preset: a presetId from the capability search, or one of extynt's own .ffx files named relative to the host library, never a path elsewhere on disk. */
export function validateApplyPreset(context: GroundedContext): OperationResult {
  const { operation, target } = context;
  const refused = rejectUnknown(operation, ["type", "target", "presetId", "presetFile"]);
  if (refused) return refused;
  if (!hasBareLayerTarget(target)) return invalid("INVALID_TARGET", "apply_preset targets a layer, not an effect or property path.");
  if (operation.presetFile !== undefined) return presetFileResult(operation);
  const presetId = operation.presetId;
  if (typeof presetId !== "string" || !PRESET_ID_PATTERN.test(presetId)) return invalid("INVALID_VALUE", "apply_preset requires a presetId from ae_search_host_capabilities (kinds:[\"preset\"]), e.g. preset:ae-presets:<20 hex>. File paths are never accepted.");
  return ACCEPTED;
}

function isLayerStyleName(value: Field): value is LayerStyleName { return typeof value === "string" && Object.hasOwn(LAYER_STYLES, value); }

function isUnstyledLayerType(type: string): boolean { return type === "camera" || type === "light" || type === "null" || type === "audio"; }

function layerStyleSettingError(style: LayerStyleName, values: JsonObject, prefix: string): Refusal | undefined {
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith(prefix) || key.length > 96 || key === LAYER_STYLES[style].matchName) return invalid("INVALID_VALUE", `${style} values are keyed by its setting matchNames starting with "${prefix}" (see ae_inspect_layer pathPrefix "${layerStylePath(style)}").`);
    if (!isStaticControlValue(value)) return invalid("INVALID_VALUE", `${key} must be a finite number, boolean, or an array of 2-4 finite numbers.`);
  }
  return undefined;
}

function layerStyleValuesError(style: LayerStyleName, values: Field, enabled: Field): Refusal | undefined {
  if (values === undefined) return undefined;
  if (!isJsonObject(values) || Object.keys(values).length < 1 || Object.keys(values).length > LAYER_STYLE_MAX_VALUES) return invalid("INVALID_VALUE", `values must be an object with 1-${LAYER_STYLE_MAX_VALUES} style settings.`);
  if (enabled === false) return invalid("INVALID_VALUE", "values cannot be set while turning the style off.");
  return layerStyleSettingError(style, values, `${LAYER_STYLES[style].matchName.split("/")[0]}/`);
}

/** ensure_layer_style: one of the supported styles, optional settings keyed by that style's matchNames, on a layer type that can carry styles. */
export function validateEnsureLayerStyle(context: GroundedContext): OperationResult {
  const { operation, target, snapshot } = context;
  const refused = rejectUnknown(operation, ["type", "target", "style", "enabled", "values"]);
  if (refused) return refused;
  if (!hasBareLayerTarget(target)) return invalid("INVALID_TARGET", "ensure_layer_style targets a layer, not an effect or property path.");
  const style = operation.style;
  if (!isLayerStyleName(style)) return invalid("INVALID_VALUE", `style must be one of ${Object.keys(LAYER_STYLES).join(", ")}.`);
  if (!isOptionalBoolean(operation.enabled)) return invalid("INVALID_VALUE", "enabled must be boolean (default true).");
  const valuesError = layerStyleValuesError(style, operation.values, operation.enabled);
  if (valuesError) return valuesError;
  const styleLayer = observedLayer(snapshot, target);
  if (styleLayer && isUnstyledLayerType(styleLayer.type)) return invalid("LAYER_STYLES_UNSUPPORTED", `Layer Styles do not apply to ${styleLayer.type} layers.`);
  return ACCEPTED;
}

function isEffectControlTarget(effectMatchName: Field, target: V2TargetReference): boolean {
  const { effectPath, propertyPath } = target;
  if (!isNonEmptyString(effectMatchName) || !effectPath || !propertyPath) return false;
  return effectPathNamesMatchName(effectPath, effectMatchName) && propertyPath.startsWith(`${effectPath}/`);
}

function effectControlKnown(context: GroundedContext): boolean {
  const { snapshot, earlier, target } = context;
  if (!snapshot) return true;
  return propertyMatchesTarget(snapshot, target, true) || hasPlannedEffect(earlier, target) || isHostResolvablePath(snapshot, target, target.propertyPath);
}

function keyframedControlError(observed: ObservedProperty | undefined, propertyPath: string | undefined): Refusal | undefined {
  if (!observed || typeof observed.keyframeCount !== "number" || observed.keyframeCount <= 0) return undefined;
  return invalid("CONFLICTING_KEYS", `${propertyPath} has ${observed.keyframeCount} keyframe(s); a static value would only change the value at the current time. Use animate_control with keyframeMode instead.`);
}

function notSettableError(observed: ObservedProperty | undefined): Refusal | undefined {
  if (!observed || observed.canSetValue !== false || observed.kind !== "property" || observed.valueType === "unknown") return undefined;
  return invalid("PROPERTY_NOT_SETTABLE", "After Effects reports this control is not settable.");
}

function effectControlStateError(context: GroundedContext): Refusal | undefined {
  const { snapshot, target } = context;
  if (!effectControlKnown(context)) return invalid("TARGET_NOT_FOUND", "The exact effect control path is not present in the current snapshot or an earlier ensure_effect operation.");
  const observed = observedProperty(snapshot, target);
  return keyframedControlError(observed, target.propertyPath) ?? notSettableError(observed);
}

/** set_effect_control: a static value for one control of an effect, where effectPath names the instance (`#2` for a second one) and effectMatchName stays the bare matchName. */
export function validateSetEffectControl(context: GroundedContext): OperationResult {
  const { operation, target } = context;
  const refused = rejectUnknown(operation, ["type", "target", "effectMatchName", "value"]);
  if (refused) return refused;
  if (ordinalInMatchName(target.effectPath, operation.effectMatchName)) return ordinalRefusal("set_effect_control", String(operation.effectMatchName));
  if (!isEffectControlTarget(operation.effectMatchName, target)) return invalid("INVALID_TARGET", "set_effect_control requires top-level effectMatchName and value, with target {compositionId, layerId, effectPath: \"ADBE Effect Parade/<effectMatchName>\" (\"#N\" appended for the Nth instance, effectMatchName unchanged), propertyPath: \"<effectPath>/<control matchName>\"}. Example: {\"type\":\"set_effect_control\",\"target\":{\"compositionId\":\"C\",\"layerId\":\"L\",\"effectPath\":\"ADBE Effect Parade/ADBE Gaussian Blur 2\",\"propertyPath\":\"ADBE Effect Parade/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001\"},\"effectMatchName\":\"ADBE Gaussian Blur 2\",\"value\":20}.");
  if (!isStaticControlValue(operation.value)) return invalid("INVALID_VALUE", "set_effect_control value must be a finite number, boolean, or an array of 2-4 finite numbers.");
  return effectControlStateError(context) ?? ACCEPTED;
}

/** ensure_text_animator: only the text.opacity role, which is the one animator property verified against the host. */
export function validateEnsureTextAnimator(context: GroundedContext): OperationResult {
  const { operation, target } = context;
  const refused = rejectUnknown(operation, ["type", "target", "role", "value"]);
  if (refused) return refused;
  if (!hasBareLayerTarget(target)) return invalid("INVALID_TARGET", "ensure_text_animator does not use an effect or property target.");
  if (operation.role !== "text.opacity") return invalid("INVALID_OPERATION", "ensure_text_animator currently only supports the text.opacity role; other animator properties are not yet host-verified.");
  if (!isFiniteInRange(operation.value, 0, 100)) return invalid("INVALID_VALUE", "text.opacity value must be a number from 0 to 100.");
  return ACCEPTED;
}

function textFieldValuesError(present: readonly string[], operation: JsonObject): Refusal | undefined {
  for (const field of present) {
    const error = textFieldError(field, operation[field]);
    if (error) return invalid("INVALID_VALUE", error);
  }
  return undefined;
}

function boxOnlyFieldError(present: readonly string[], context: GroundedContext): Refusal | undefined {
  const boxFields = present.filter((field) => BOX_ONLY_FIELDS.includes(field));
  const document = observedLayer(context.snapshot, context.target)?.properties.find((property) => property.path === TEXT_DOCUMENT_PATH)?.value;
  if (!boxFields.length || !isJsonObject(document) || document.boxText !== false) return undefined;
  return invalid("TEXT_BOX_ONLY", `${boxFields.join(", ")} apply only to box (paragraph) text; this layer is point text. Create box text with create_layer box:[w,h].`);
}

function characterRangeBoundsError(start: Field, end: Field): Refusal | undefined {
  const ordered = typeof start === "number" && typeof end === "number" && Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start;
  if (ordered && end <= MAX_CHARACTER_RANGE_END) return undefined;
  return invalid("INVALID_VALUE", "Character ranges need integer start < end within the 4096-character text bound.");
}

function characterRangeError(range: JsonValue): Refusal | undefined {
  if (!isJsonObject(range)) return invalid("INVALID_VALUE", "Each character range must be an object.");
  const { start, end, ...styles } = range;
  const boundsError = characterRangeBoundsError(start, end);
  if (boundsError) return boundsError;
  const styleFields = Object.keys(styles);
  if (!styleFields.length) return invalid("INVALID_VALUE", "A character range must set at least one character field.");
  for (const field of styleFields) {
    const error = textFieldError(field, styles[field], ["character"], true);
    if (error) return invalid("INVALID_VALUE", `characterRanges: ${error}`);
  }
  return undefined;
}

function characterRangesError(ranges: Field): Refusal | undefined {
  if (ranges === undefined) return undefined;
  if (!isJsonArray(ranges) || ranges.length < 1 || ranges.length > TEXT_RANGE_MAX) return invalid("INVALID_VALUE", `characterRanges must hold 1-${TEXT_RANGE_MAX} ranges.`);
  for (const range of ranges) {
    const error = characterRangeError(range);
    if (error) return error;
  }
  return undefined;
}

/** set_text_document: typed text fields and per-range character styles on a text layer; box-only fields are refused on observed point text before approval instead of failing mid-apply. */
export function validateSetTextDocument(context: GroundedContext): OperationResult {
  const { operation, target } = context;
  const refused = rejectUnknown(operation, ["type", "target", "characterRanges", ...TEXT_FIELD_NAMES]);
  if (refused) return refused;
  if (!hasBareLayerTarget(target)) return invalid("INVALID_TARGET", "set_text_document targets a text layer, not an arbitrary property path.");
  const present = TEXT_FIELD_NAMES.filter((field) => operation[field] !== undefined);
  const ranges = operation.characterRanges;
  if (!present.length && ranges === undefined) return invalid("INVALID_OPERATION", "set_text_document requires at least one typed text field or character range.");
  return textFieldValuesError(present, operation) ?? boxOnlyFieldError(present, context) ?? characterRangesError(ranges) ?? ACCEPTED;
}

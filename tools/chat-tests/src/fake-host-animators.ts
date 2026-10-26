/**
 * Text animators: the animator group a text layer carries, its selector, and the animator
 * property and selector setting leaves that hang off them. The animator property table is copied
 * from the typed table in packages/action-plan/src/extended.ts.
 */

import type { LayerSnapshot, PropertySnapshot } from "@extynt/project-graph";
import { isWireArray, isWireObject } from "@extynt/fake-plugin";
import { ordinalOf, resolveLayer, resolveOrdinal, type ApplyOutcome, type FixtureApplyContext } from "./fake-host-context.js";

import { parseFrames, writeKeyframes } from "./fake-host-keyframes.js";
import { childSegment, childrenOf, group, keyframeCount, materializeSetting, propertyOf } from "./fake-host-model.js";
import { CANONICAL_PREFIX, type SpecKind } from "./fake-host-tables.js";
import { jsonOf, placeholderOf, refuse, required, specValueError, textOf, type Field } from "./fake-host-values.js";
import type { WireObject, WireValue } from "./wire-types.js";

type SpecTable = Readonly<Record<string, readonly [path: string, kind: SpecKind]>>;

interface TextSelectorSpec { matchName: string; displayName: string; settings: SpecTable }

interface PlannedValue { key: string; path: string; kind: SpecKind; value: WireValue }

interface PlannedAnimation { key: string; path: string; kind: SpecKind; frames: WireValue }

interface PlannedAnimator { selector: TextSelectorSpec; values: PlannedValue[]; animations: PlannedAnimation[]; amountExpression: string | undefined }

interface AnimatorMode {
  type: "add_text_animator" | "update_text_animator";
  requireContent: (planned: PlannedAnimator) => void;
  animatorFor: (context: FixtureApplyContext, animators: PropertySnapshot, operation: WireObject, planned: PlannedAnimator) => PropertySnapshot;
  created: boolean;
  describe: (animator: PropertySnapshot, ordinal: number, layer: LayerSnapshot) => string;
}

const ANIMATORS_PATH = "ADBE Text Properties/ADBE Text Animators";

const ANIMATOR = "ADBE Text Animator";

const SELECTORS = "ADBE Text Selectors";

const PROPS = "ADBE Text Animator Properties";

const ADVANCED = "ADBE Text Range Advanced";

const TEXT_ANIMATOR_PROPERTIES: SpecTable = {
  anchorPoint: [`${PROPS}/ADBE Text Anchor Point 3D`, "vec23"], position: [`${PROPS}/ADBE Text Position 3D`, "vec23"], scale: [`${PROPS}/ADBE Text Scale 3D`, "vec23"],
  skew: [`${PROPS}/ADBE Text Skew`, "number"], skewAxis: [`${PROPS}/ADBE Text Skew Axis`, "number"], rotation: [`${PROPS}/ADBE Text Rotation`, "number"], rotationX: [`${PROPS}/ADBE Text Rotation X`, "number"], rotationY: [`${PROPS}/ADBE Text Rotation Y`, "number"],
  opacity: [`${PROPS}/ADBE Text Opacity`, "number"],
  fillColor: [`${PROPS}/ADBE Text Fill Color`, "color"], fillHue: [`${PROPS}/ADBE Text Fill Hue`, "number"], fillSaturation: [`${PROPS}/ADBE Text Fill Saturation`, "number"], fillBrightness: [`${PROPS}/ADBE Text Fill Brightness`, "number"], fillOpacity: [`${PROPS}/ADBE Text Fill Opacity`, "number"],
  strokeColor: [`${PROPS}/ADBE Text Stroke Color`, "color"], strokeHue: [`${PROPS}/ADBE Text Stroke Hue`, "number"], strokeSaturation: [`${PROPS}/ADBE Text Stroke Saturation`, "number"], strokeBrightness: [`${PROPS}/ADBE Text Stroke Brightness`, "number"], strokeOpacity: [`${PROPS}/ADBE Text Stroke Opacity`, "number"], strokeWidth: [`${PROPS}/ADBE Text Stroke Width`, "number"],
  lineAnchor: [`${PROPS}/ADBE Text Line Anchor`, "number"], lineSpacing: [`${PROPS}/ADBE Text Line Spacing`, "vec2"], trackingType: [`${PROPS}/ADBE Text Track Type`, "menu"], trackingAmount: [`${PROPS}/ADBE Text Tracking Amount`, "number"],
  characterAlignment: [`${PROPS}/ADBE Text Character Change Type`, "menu"], characterRange: [`${PROPS}/ADBE Text Character Range`, "menu"], characterValue: [`${PROPS}/ADBE Text Character Replace`, "number"], characterOffset: [`${PROPS}/ADBE Text Character Offset`, "number"],
  blur: [`${PROPS}/ADBE Text Blur`, "vec2"],
};

const TEXT_SELECTORS: Readonly<Record<string, TextSelectorSpec>> = {
  range: { matchName: "ADBE Text Selector", displayName: "Range Selector", settings: {
    start: ["ADBE Text Percent Start", "number"], end: ["ADBE Text Percent End", "number"], offset: ["ADBE Text Percent Offset", "number"],
    indexStart: ["ADBE Text Index Start", "number"], indexEnd: ["ADBE Text Index End", "number"], indexOffset: ["ADBE Text Index Offset", "number"],
    units: [`${ADVANCED}/ADBE Text Range Units`, "menu"], basedOn: [`${ADVANCED}/ADBE Text Range Type2`, "menu"], mode: [`${ADVANCED}/ADBE Text Selector Mode`, "menu"], amount: [`${ADVANCED}/ADBE Text Selector Max Amount`, "number"],
    shape: [`${ADVANCED}/ADBE Text Range Shape`, "menu"], smoothness: [`${ADVANCED}/ADBE Text Selector Smoothness`, "number"], easeHigh: [`${ADVANCED}/ADBE Text Levels Max Ease`, "number"], easeLow: [`${ADVANCED}/ADBE Text Levels Min Ease`, "number"],
    randomize: [`${ADVANCED}/ADBE Text Randomize Order`, "boolean"], randomSeed: [`${ADVANCED}/ADBE Text Random Seed`, "number"],
  } },
  wiggly: { matchName: "ADBE Text Wiggly Selector", displayName: "Wiggly Selector", settings: {
    mode: ["ADBE Text Selector Mode", "menu"], maxAmount: ["ADBE Text Wiggly Max Amount", "number"], minAmount: ["ADBE Text Wiggly Min Amount", "number"], basedOn: ["ADBE Text Range Type2", "menu"],
    wigglesPerSecond: ["ADBE Text Temporal Freq", "number"], correlation: ["ADBE Text Character Correlation", "number"], temporalPhase: ["ADBE Text Temporal Phase", "number"], spatialPhase: ["ADBE Text Spatial Phase", "number"],
    lockDimensions: ["ADBE Text Wiggly Lock Dim", "boolean"], randomSeed: ["ADBE Text Wiggly Random Seed", "number"],
  } },
  expression: { matchName: "ADBE Text Expressible Selector", displayName: "Expression Selector", settings: { basedOn: ["ADBE Text Range Type2", "menu"], amount: ["ADBE Text Expressible Amount", "number"] } },
};

const TRANSLATED_MEMBERS: ReadonlySet<string> = new Set(["writes", "animations", "selectorMatchName", "amountExpression"]);

function selectorTypeOf(selector: Field): string {
  if (selector === undefined) return "range";
  if (!isWireObject(selector)) refuse("INVALID_VALUE", "selector must be an object.");
  const type = selector.type ?? "range";
  if (typeof type !== "string" || !Object.hasOwn(TEXT_SELECTORS, type)) refuse("INVALID_VALUE", `selector.type must be one of ${Object.keys(TEXT_SELECTORS).join(", ")}.`);
  return type;
}

function specOf(key: string, selector: TextSelectorSpec): readonly [path: string, kind: SpecKind] | undefined {
  if (Object.hasOwn(TEXT_ANIMATOR_PROPERTIES, key)) return TEXT_ANIMATOR_PROPERTIES[key];
  const setting = key.startsWith("selector.") ? key.slice("selector.".length) : undefined;
  const found = setting !== undefined && Object.hasOwn(selector.settings, setting) ? selector.settings[setting] : undefined;
  return found ? [`${SELECTORS}/${selector.matchName}/${found[0]}`, found[1]] : undefined;
}

function specKeysOf(selector: TextSelectorSpec): string[] {
  return [...Object.keys(TEXT_ANIMATOR_PROPERTIES), ...Object.keys(selector.settings).map((key) => `selector.${key}`)];
}

function requireObjectFields(operation: WireObject, selectorSpec: WireObject, label: string): void {
  if (operation.properties !== undefined && !isWireObject(operation.properties)) refuse("INVALID_VALUE", `${label}: properties must be an object of animator property values.`);
  if (selectorSpec.settings !== undefined && !isWireObject(selectorSpec.settings)) refuse("INVALID_VALUE", `${label}: selector.settings must be an object.`);
  if (operation.keyframes !== undefined && !isWireObject(operation.keyframes)) refuse("INVALID_VALUE", `${label}: keyframes must map setting names to keyframe arrays.`);
}

function givenSettings(properties: Field, selectorSettings: Field): Record<string, WireValue> {
  const given: Record<string, WireValue> = { ...(isWireObject(properties) ? properties : {}) };
  if (isWireObject(selectorSettings)) for (const [key, value] of Object.entries(selectorSettings)) given[`selector.${key}`] = value;
  return given;
}

function plannedValues(given: Record<string, WireValue>, selector: TextSelectorSpec, label: string): PlannedValue[] {
  return Object.entries(given).map(([key, value]) => {
    const spec = specOf(key, selector);
    if (!spec) refuse("INVALID_VALUE", `${label} has no setting "${key}"; use one of ${specKeysOf(selector).join(", ")}.`);
    const error = specValueError(spec[1], value);
    if (error) refuse("INVALID_VALUE", `${label}.${key} ${error}.`);
    return { key, path: spec[0], kind: spec[1], value };
  });
}

function plannedAnimations(keyframes: Field, given: Record<string, WireValue>, selector: TextSelectorSpec, label: string): PlannedAnimation[] {
  return Object.entries(isWireObject(keyframes) ? keyframes : {}).map(([key, frames]) => {
    const spec = specOf(key, selector);
    if (!spec) refuse("INVALID_VALUE", `${label} has no animatable setting "${key}"; use one of ${specKeysOf(selector).join(", ")}.`);
    if (spec[1] === "boolean" || spec[1] === "menu") refuse("INVALID_VALUE", `${label}.${key} is a ${spec[1]} and is set statically, not keyframed.`);
    if (key in given) refuse("INVALID_VALUE", `${label}.${key} cannot be both set and keyframed in one operation.`);
    parseFrames(frames, `${label}.${key}`);
    return { key, path: spec[0], kind: spec[1], frames };
  });
}

function planAnimator(operation: WireObject, label: string): PlannedAnimator {
  const selectorType = selectorTypeOf(operation.selector);
  const selector = required(TEXT_SELECTORS[selectorType], `the ${selectorType} selector`);
  const rawSelector = operation.selector;
  const selectorSpec = isWireObject(rawSelector) ? rawSelector : {};
  requireObjectFields(operation, selectorSpec, label);
  const given = givenSettings(operation.properties, selectorSpec.settings);
  const values = plannedValues(given, selector, label);
  const animations = plannedAnimations(operation.keyframes, given, selector, label);
  const amountExpression = selectorSpec.amountExpression;
  if (amountExpression !== undefined && (selectorType !== "expression" || typeof amountExpression !== "string")) refuse("INVALID_VALUE", "amountExpression applies only to an expression selector and must be a string.");
  return { selector, values, animations, amountExpression: typeof amountExpression === "string" ? amountExpression : undefined };
}

function animatorsGroupOf(layer: LayerSnapshot): PropertySnapshot {
  const animators = propertyOf(layer, ANIMATORS_PATH);
  if (!animators) refuse("PROPERTY_NOT_FOUND", `Layer ${layer.id} "${layer.name}" has no Text Animators group in this fixture.`);
  return animators;
}

function resolveAnimator(context: FixtureApplyContext, animators: PropertySnapshot, rawId: Field): PropertySnapshot {
  if (typeof rawId !== "string" || rawId.length === 0) refuse("INVALID_TARGET", "update_text_animator requires animatorId.");
  const named = rawId.startsWith(CANONICAL_PREFIX) ? context.bindings[rawId] : rawId;
  const match = typeof named === "string" ? /^animator:([1-9][0-9]{0,2})$/.exec(named) : null;
  if (!match) refuse("TARGET_NOT_FOUND", "update_text_animator: animatorId must be animator:<n> or a newAnimatorId added earlier on this layer.");
  const found = resolveOrdinal(animators, ANIMATOR, Number(match[1]));
  if (!found) refuse("TARGET_NOT_FOUND", `update_text_animator: no animator at ordinal ${match[1]} on this layer.`);
  return found;
}

function createAnimator(context: FixtureApplyContext, animators: PropertySnapshot, operation: WireObject, planned: PlannedAnimator): PropertySnapshot {
  const placeholder = placeholderOf(operation.newAnimatorId, "add_text_animator declares newAnimatorId, which must be a __new__:<name> placeholder for the animator it creates.");
  const name = operation.name;
  if (name !== undefined && name !== null) textOf(name, "add_text_animator name", { min: 1, max: 256 });
  const path = `${animators.path}/${childSegment(animators, ANIMATOR)}`;
  const selectorsPath = `${path}/${SELECTORS}`;
  const selector = group(`${selectorsPath}/${planned.selector.matchName}`, planned.selector.matchName, `${planned.selector.displayName} 1`);
  const created = group(path, ANIMATOR, typeof name === "string" ? name : `Animator ${childrenOf(animators).length + 1}`, [group(selectorsPath, SELECTORS, "Selectors", [selector])]);
  childrenOf(animators).push(created);
  context.bindings[placeholder] = `animator:${ordinalOf(animators, ANIMATOR, created)}`;
  return created;
}

function writeSettings(
  animator: PropertySnapshot,
  planned: PlannedAnimator,
  source: { keyframeMode: Field; label: string },
): { writes: WireObject[]; animations: WireObject[] } {
  const writes = planned.values.map((write) => {
    const property = materializeSetting(animator, write.path, write.kind);
    property.value = jsonOf(write.value);
    return { path: property.path, value: property.value };
  });
  const animations = planned.animations.map((animation) => {
    const property = materializeSetting(animator, animation.path, animation.kind);
    writeKeyframes(property, animation.frames, source.keyframeMode, `${source.label}.${animation.key}`);
    return { path: property.path, keyframes: animation.frames, keyframeMode: typeof source.keyframeMode === "string" ? source.keyframeMode : "reject", afterKeys: keyframeCount(property) };
  });
  return { writes, animations };
}

function writeAmountExpression(animator: PropertySnapshot, planned: PlannedAnimator): void {
  if (planned.amountExpression === undefined) return;
  const amount = materializeSetting(animator, `${SELECTORS}/${planned.selector.matchName}/ADBE Text Expressible Amount`, "number");
  amount.expression = planned.amountExpression;
  amount.expressionEnabled = planned.amountExpression.length > 0;
}

const ADD_MODE: AnimatorMode = {
  type: "add_text_animator",
  requireContent: (planned) => {
    if (planned.values.length + planned.animations.length === 0) refuse("INVALID_OPERATION", `add_text_animator needs at least one animator property in properties or keyframes (${Object.keys(TEXT_ANIMATOR_PROPERTIES).join(", ")}).`);
  },
  animatorFor: createAnimator,
  created: true,
  describe: (animator, ordinal, layer) => `added text animator animator:${ordinal} "${animator.displayName}" on layer ${layer.id}`,
};

const UPDATE_MODE: AnimatorMode = {
  type: "update_text_animator",
  requireContent: (planned) => {
    if (planned.values.length + planned.animations.length === 0 && planned.amountExpression === undefined) refuse("INVALID_OPERATION", "update_text_animator requires properties, selector settings, or keyframes.");
  },
  animatorFor: (context, animators, operation) => resolveAnimator(context, animators, operation.animatorId),
  created: false,
  describe: (_animator, ordinal, layer) => `updated text animator animator:${ordinal} on layer ${layer.id}`,
};

function applyTextAnimator(context: FixtureApplyContext, operation: WireObject, mode: AnimatorMode): ApplyOutcome {
  const { layer } = resolveLayer(context, operation, mode.type);
  if (layer.type !== "text") refuse("INVALID_TARGET", `${mode.type} applies only to text layers; ${layer.id} is a ${layer.type} layer.`);
  const animators = animatorsGroupOf(layer);
  const planned = planAnimator(operation, mode.type);
  mode.requireContent(planned);
  const animator = mode.animatorFor(context, animators, operation, planned);
  const written = writeSettings(animator, planned, { keyframeMode: operation.keyframeMode, label: mode.type });
  writeAmountExpression(animator, planned);
  context.evidence = { containerPath: animator.path, created: mode.created, ...written };
  return mode.describe(animator, ordinalOf(animators, ANIMATOR, animator), layer);
}

/** Adds a text animator with its selector and the first property values or keyframes. */
export function applyAddTextAnimator(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  return applyTextAnimator(context, operation, ADD_MODE);
}

/** Writes property values, selector settings, keyframes or an amount expression onto an existing text animator. */
export function applyUpdateTextAnimator(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  return applyTextAnimator(context, operation, UPDATE_MODE);
}

function selectorSettingOf(path: string, selector: TextSelectorSpec | undefined): string | undefined {
  if (!selector) return undefined;
  const prefix = `${SELECTORS}/${selector.matchName}/`;
  if (!path.startsWith(prefix)) return undefined;
  return Object.entries(selector.settings).find(([, spec]) => `${prefix}${spec[0]}` === path)?.[0];
}

function keyOfHostPath(path: Field, selector: TextSelectorSpec | undefined): string {
  if (typeof path !== "string") return String(path);
  const property = Object.keys(TEXT_ANIMATOR_PROPERTIES).find((key) => TEXT_ANIMATOR_PROPERTIES[key]?.[0] === path);
  if (property) return property;
  const setting = selectorSettingOf(path, selector);
  return setting ? `selector.${setting}` : path;
}

function rowsOf(value: Field): WireObject[] { return isWireArray(value) ? value.filter(isWireObject) : []; }

function groupedWrites(
  writes: WireObject[],
  selector: TextSelectorSpec | undefined,
): { properties: Record<string, WireValue>; settings: Record<string, WireValue> } {
  const properties: Record<string, WireValue> = {};
  const settings: Record<string, WireValue> = {};
  for (const write of writes) {
    const key = keyOfHostPath(write.path, selector);
    if (key.startsWith("selector.")) settings[key.slice("selector.".length)] = write.value ?? null; else properties[key] = write.value ?? null;
  }
  return { properties, settings };
}

function sharedKeyframeMode(animations: WireObject[]): WireObject {
  const modes = new Set(animations.map((animation) => animation.keyframeMode).filter((mode): mode is string => typeof mode === "string"));
  if (modes.size === 0) return {};
  return { keyframeMode: modes.size === 1 ? [...modes].join("") : [...modes].sort().join("|") };
}

function selectorField(selectorType: string | undefined, settings: Record<string, WireValue>, amountExpression: Field): WireObject {
  if (!selectorType) return {};
  return { selector: { type: selectorType, settings, ...(amountExpression !== undefined ? { amountExpression } : {}) } };
}

function isGroupedTextAnimator(operation: WireObject, writes: WireObject[], animations: WireObject[]): boolean {
  const isAnimator = operation.type === "add_text_animator" || operation.type === "update_text_animator";
  return isAnimator && (operation.selectorMatchName !== undefined || writes.length > 0 || animations.length > 0);
}

/**
 * Translate a compiled text-animator write back into the plan's `properties`, `selector` and
 * `keyframes`. A path the tables cannot resolve stays in `properties`, so the applier refuses it by name.
 */
export function translateTextAnimatorGrouping(operation: WireObject): WireObject {
  const writes = rowsOf(operation.writes);
  const animations = rowsOf(operation.animations);
  if (!isGroupedTextAnimator(operation, writes, animations)) return operation;
  const selectorType = Object.keys(TEXT_SELECTORS).find((key) => TEXT_SELECTORS[key]?.matchName === operation.selectorMatchName);
  const selector = selectorType ? TEXT_SELECTORS[selectorType] : undefined;
  const { properties, settings } = groupedWrites(writes, selector);
  const keyframes: Record<string, WireValue> = {};
  for (const animation of animations) keyframes[keyOfHostPath(animation.path, selector)] = animation.keyframes ?? null;
  const rest = Object.fromEntries(Object.entries(operation).filter(([key]) => !TRANSLATED_MEMBERS.has(key)));
  return { ...rest, properties, keyframes, ...selectorField(selectorType, settings, operation.amountExpression), ...sharedKeyframeMode(animations) };
}

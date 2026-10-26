/** Effect operations in the fixture: ensure_effect, layer styles, set_effect_control and animate_control. */

import { flattenProperties, stableStringify, type LayerSnapshot, type PropertySnapshot } from "@extynt/project-graph";
import { type JsonValue } from "@extynt/decode";
import { isWireArray, isWireObject } from "@extynt/fake-plugin";
import { resolveLayer, type ApplyOutcome, type FixtureApplyContext } from "./fake-host-context.js";
import { effectControlsFor, effectDisplayName } from "./fake-host-effects.js";
import { animateKeys } from "./fake-host-animate.js";
import { childrenOf, ensureChildGroup, findChild, keyframeCount, layerRoot, propertyOf, requireSettable } from "./fake-host-model.js";
import { EFFECT_PARADE, UNSUPPORTED_IN_FIXTURE } from "./fake-host-tables.js";
import { escapeSegment, refuse, targetOf, textOf, toJson, jsonOf, type Field, type JsonObject } from "./fake-host-values.js";
import type { WireObject } from "./wire-types.js";

interface RequestedStyle { style: string; styleMatchName: string; enabled: boolean }

const LAYER_STYLE_MATCH_NAMES: Readonly<Record<string, string>> = {
  "drop-shadow": "dropShadow/enabled", "inner-shadow": "innerShadow/enabled", "outer-glow": "outerGlow/enabled", "inner-glow": "innerGlow/enabled",
  "bevel-emboss": "bevelEmboss/enabled", "satin": "chromeFX/enabled", "color-overlay": "solidFill/enabled", "gradient-overlay": "gradientFill/enabled", "stroke": "frameFX/enabled",
};

const LAYER_STYLE_GROUP = "ADBE Layer Styles";

function effectInstances(layer: LayerSnapshot, matchName: string): PropertySnapshot[] {
  return flattenProperties(layer.properties).filter((property) => property.matchName === matchName && property.path.startsWith(`${EFFECT_PARADE}/`) && property.path.split("/").length === 2);
}

function existingEffect(instances: readonly PropertySnapshot[], matchName: string, effectPath: Field): PropertySnapshot | undefined {
  if (typeof effectPath !== "string") return instances[0];
  const rawPrefix = `${EFFECT_PARADE}/${matchName}`;
  const path = effectPath.startsWith(rawPrefix) ? `${EFFECT_PARADE}/${escapeSegment(matchName)}${effectPath.slice(rawPrefix.length)}` : effectPath;
  return instances.find((instance) => instance.path === path);
}

function nextEffectSegment(instances: readonly PropertySnapshot[], matchName: string): string {
  return instances.length > 0 ? `${escapeSegment(matchName)}#${instances.length + 1}` : escapeSegment(matchName);
}

function addEffect(parade: PropertySnapshot, instances: readonly PropertySnapshot[], effect: { matchName: string; enabled: boolean }): string {
  const { matchName, enabled } = effect;
  const effectPath = `${parade.path}/${nextEffectSegment(instances, matchName)}`;
  const controls = effectControlsFor(matchName).map((control) => ({ ...control, path: `${effectPath}/${control.matchName}` }));
  childrenOf(parade).push({ path: effectPath, matchName, displayName: effectDisplayName(matchName), kind: "effect", valueType: "unknown", value: null, canSetValue: false, enabled, children: controls });
  return `added effect ${matchName} at ${effectPath}${controls.length === 0 ? " (the fixture records no controls for this effect)" : ""}`;
}

/** Adds an effect to the layer, or reuses the one already there, optionally switching it on or off. */
export function applyEnsureEffect(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const { layer } = resolveLayer(context, operation, "ensure_effect");
  const matchName = textOf(operation.effectMatchName, "ensure_effect effectMatchName", { min: 1, max: 256 });
  const enabled = operation.enabled;
  if (enabled !== undefined && typeof enabled !== "boolean") refuse("INVALID_VALUE", "ensure_effect enabled must be boolean.");
  const parade = ensureChildGroup(layerRoot(layer), EFFECT_PARADE, "Effects");
  const instances = effectInstances(layer, matchName);
  const existing = existingEffect(instances, matchName, targetOf(operation).effectPath ?? operation.effectPath);
  if (!existing) return addEffect(parade, instances, { matchName, enabled: enabled ?? true });
  if (enabled !== undefined) existing.enabled = enabled;
  return `reused effect ${matchName} at ${existing.path}`;
}

function styleSettingType(value: JsonValue): PropertySnapshot["valueType"] {
  if (typeof value === "boolean") return "boolean";
  if (!Array.isArray(value)) return "number";
  return value.length === 3 || value.length === 4 ? "color" : "vector";
}

function requestedLayerStyle(layer: LayerSnapshot, operation: WireObject): RequestedStyle {
  const style = typeof operation.style === "string" ? operation.style : "";
  const styleMatchName = LAYER_STYLE_MATCH_NAMES[style];
  const enabled = operation.enabled;
  if (!styleMatchName) refuse("INVALID_VALUE", `ensure_layer_style style must be one of ${Object.keys(LAYER_STYLE_MATCH_NAMES).join(", ")}.`);
  if (enabled !== undefined && typeof enabled !== "boolean") refuse("INVALID_VALUE", "ensure_layer_style enabled must be boolean (default true).");
  if (["camera", "light", "null", "audio"].includes(layer.type)) refuse("LAYER_STYLES_UNSUPPORTED", `Layer Styles do not apply to ${layer.type} layers.`);
  return { style, styleMatchName, enabled: enabled ?? true };
}

function isStyleValue(value: Field): boolean {
  return toJson(value) !== undefined && (typeof value === "boolean" || typeof value === "number" || isWireArray(value));
}

function requireStyleSetting(key: string, value: Field, requested: RequestedStyle): void {
  const prefix = `${requested.styleMatchName.split("/")[0]}/`;
  if (!key.startsWith(prefix) || key === requested.styleMatchName || key.length > 96) refuse("INVALID_VALUE", `ensure_layer_style ${requested.style} values are keyed by its setting matchNames starting with "${prefix}".`);
  if (!isStyleValue(value)) refuse("INVALID_VALUE", `ensure_layer_style ${key} must be a finite number, boolean, or an array of 2-4 finite numbers.`);
}

function checkedStyleValues(values: Field, requested: RequestedStyle): WireObject {
  if (values === undefined) return {};
  if (!isWireObject(values) || Object.keys(values).length < 1 || Object.keys(values).length > 16) refuse("INVALID_VALUE", "ensure_layer_style values must be an object with 1-16 style settings.");
  if (!requested.enabled) refuse("INVALID_VALUE", "ensure_layer_style values cannot be set while turning the style off.");
  for (const [key, value] of Object.entries(values)) requireStyleSetting(key, value, requested);
  return values;
}

function writeStyleValues(node: PropertySnapshot, values: WireObject): JsonObject {
  const written: JsonObject = {};
  for (const [key, value] of Object.entries(values)) {
    const json = jsonOf(value);
    const existing = findChild(node, key);
    if (existing) existing.value = json;
    else childrenOf(node).push({ path: `${node.path}/${escapeSegment(key)}`, matchName: key, displayName: key, kind: "property", valueType: styleSettingType(json), value: json, canSetValue: true });
    written[key] = json;
  }
  return written;
}

function newStyleNode(root: PropertySnapshot, requested: RequestedStyle): PropertySnapshot {
  const node: PropertySnapshot = { path: `${root.path}/${escapeSegment(requested.styleMatchName)}`, matchName: requested.styleMatchName, displayName: requested.style, kind: "group", valueType: "unknown", value: null, canSetValue: false, enabled: requested.enabled, children: [] };
  childrenOf(root).push(node);
  return node;
}

/**
 * ensure_layer_style as the panel does it: enable the style (adding it when absent), then write each setting under its group; turning off an
 * absent style adds nothing.
 */
export function applyEnsureLayerStyle(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const { layer } = resolveLayer(context, operation, "ensure_layer_style");
  const requested = requestedLayerStyle(layer, operation);
  const values = checkedStyleValues(operation.values, requested);
  const root = ensureChildGroup(layerRoot(layer), LAYER_STYLE_GROUP, "Layer Styles");
  const existing = findChild(root, requested.styleMatchName);
  if (!existing && !requested.enabled) {
    context.evidence = { created: false, enabled: false };
    return `layer style ${requested.style} is not on layer ${layer.id}; nothing to turn off`;
  }
  const node = existing ?? newStyleNode(root, requested);
  node.enabled = requested.enabled;
  const written = writeStyleValues(node, values);
  const created = existing === undefined;
  context.evidence = { created, enabled: requested.enabled, ...(Object.keys(written).length > 0 ? { values: written } : {}) };
  return `${created ? "added" : "updated"} layer style ${requested.style} on layer ${layer.id}${requested.enabled ? "" : " (off)"}`;
}

function effectControlOf(context: FixtureApplyContext, operation: WireObject, type: string): { property: PropertySnapshot; requestedPath: string } {
  const { layer } = resolveLayer(context, operation, type);
  const matchName = textOf(operation.effectMatchName, `${type} effectMatchName`, { min: 1, max: 256 });
  const requestedPath = targetOf(operation).propertyPath;
  if (typeof requestedPath !== "string" || !requestedPath.startsWith(`${EFFECT_PARADE}/`)) {
    refuse("INVALID_TARGET", `${type} requires target.propertyPath under ${EFFECT_PARADE}/, e.g. ${EFFECT_PARADE}/<effectMatchName>/<controlMatchName>.`);
  }
  const rawPrefix = `${EFFECT_PARADE}/${matchName}/`;
  const path = requestedPath.startsWith(rawPrefix) ? `${EFFECT_PARADE}/${escapeSegment(matchName)}/${requestedPath.slice(rawPrefix.length)}` : requestedPath;
  const property = propertyOf(layer, path);
  if (!property) refuse("PROPERTY_NOT_FOUND", `${type}: ${requestedPath} is not present on layer ${layer.id} in this fixture. The fixture records only the top-level controls its host profile lists for an added effect; it will not invent one.`);
  requireSettable(property, type);
  return { property, requestedPath };
}

/** Writes a static value to an effect control that has no keyframes. */
export function applySetEffectControl(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const { property, requestedPath } = effectControlOf(context, operation, "set_effect_control");
  if (keyframeCount(property) > 0) refuse("CONFLICTING_KEYS", `${requestedPath} has ${keyframeCount(property)} keyframe(s); a static value would only change the value at the current time. Use animate_control with keyframeMode instead.`);
  const value = toJson(operation.value);
  if (value === undefined) refuse("INVALID_VALUE", "set_effect_control value must be a finite number, boolean, or an array of 2-4 finite numbers.");
  property.value = value;
  return `set ${property.path} to ${stableStringify(value)}`;
}

/** Writes keyframes onto an effect control, refusing unanimatable controls and inline expressions. */
export function applyAnimateControl(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const { property, requestedPath } = effectControlOf(context, operation, "animate_control");
  if (property.animatable === false) refuse("PROPERTY_NOT_ANIMATABLE", `animate_control: After Effects reports ${property.path} as not animatable.`);
  if (operation.expression !== undefined) refuse(UNSUPPORTED_IN_FIXTURE, "animate_control with an inline expression is not modelled by the fixture harness; write the keys with animate_control and the expression with set_expression.");
  animateKeys(context, property, { source: operation, type: "animate_control", requestedPath });
  return `animated ${property.path} with ${property.keyframeCount ?? 0} keyframe(s)`;
}

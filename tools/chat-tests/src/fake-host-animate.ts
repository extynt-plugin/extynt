/** Property animation in the fixture: animate_property, set_expression, and the evidence a key write leaves. */

import type { PropertySnapshot } from "@extynt/project-graph";
import { resolveLayer, type ApplyOutcome, type FixtureApplyContext } from "./fake-host-context.js";
import { writeKeyframes } from "./fake-host-keyframes.js";
import { keyframeCount, requireProperty, requireSettable } from "./fake-host-model.js";
import { EFFECT_PARADE, UNSUPPORTED_IN_FIXTURE } from "./fake-host-tables.js";
import { propertyPathOf, refuse } from "./fake-host-values.js";
import type { WireObject } from "./wire-types.js";

/** Writes an operation's keyframes onto the property and leaves the key evidence the verdict reports. */
export function animateKeys(
  context: FixtureApplyContext,
  property: PropertySnapshot,
  operation: { source: WireObject; type: string; requestedPath: string },
): void {
  const beforeKeys = keyframeCount(property);
  writeKeyframes(property, operation.source.keyframes, operation.source.keyframeMode, operation.type);
  context.evidence = {
    propertyPath: operation.requestedPath,
    beforeKeys,
    afterKeys: keyframeCount(property),
    afterDigest: property.keyDigest ?? null,
    expressionEnabled: property.expressionEnabled === true,
  };
}

/** Writes keyframes onto a layer property, refusing effect controls, unanimatable properties and inline expressions. */
export function applyAnimateProperty(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const { layer } = resolveLayer(context, operation, "animate_property");
  const requestedPath = propertyPathOf(operation);
  if (requestedPath === undefined) refuse("INVALID_TARGET", "animate_property requires target.propertyPath.");
  if (requestedPath.startsWith(`${EFFECT_PARADE}/`)) refuse("INVALID_TARGET", "animate_property addresses layer properties; effect controls are animated by animate_control.");
  const property = requireProperty(layer, requestedPath, "animate_property");
  requireSettable(property, "animate_property");
  if (property.animatable === false) refuse("PROPERTY_NOT_ANIMATABLE", `animate_property: After Effects reports ${property.path} as not animatable.`);
  if (operation.expression !== undefined) refuse(UNSUPPORTED_IN_FIXTURE, "animate_property with an inline expression is not modelled by the fixture harness; write the keys with animate_property and the expression with set_expression.");
  animateKeys(context, property, { source: operation, type: "animate_property", requestedPath });
  return `animated ${property.path} with ${property.keyframeCount ?? 0} keyframe(s)`;
}

/** Stores an expression and whether it is enabled on a property. */
export function applySetExpression(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const { layer } = resolveLayer(context, operation, "set_expression");
  const requestedPath = propertyPathOf(operation);
  if (requestedPath === undefined) refuse("INVALID_TARGET", "set_expression requires target.propertyPath.");
  const property = requireProperty(layer, requestedPath, "set_expression");
  const { source, enabled } = operation;
  if (property.kind !== "property") refuse("PROPERTY_NOT_SETTABLE", `set_expression: ${property.path} is a group, and After Effects only evaluates expressions on properties.`);
  if (typeof source !== "string" || source.length > 4096) refuse("INVALID_VALUE", "set_expression source must be a string of at most 4096 characters.");
  if (typeof enabled !== "boolean") refuse("INVALID_VALUE", "set_expression enabled must be boolean.");
  const existingKeys = keyframeCount(property);
  property.expression = source;
  property.expressionEnabled = enabled;
  context.evidence = { propertyPath: requestedPath, expressionExistingKeys: existingKeys, expressionEnabled: enabled, ...(enabled ? { verification: "expression-enabled" } : {}) };
  return `set expression on ${property.path}`;
}

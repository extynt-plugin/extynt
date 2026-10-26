// The router for operations on a property row: set_layer_property, set_expression, animate_property, animate_control and ensure_effect, each judged by its own verdict after the row's presence.
import { hostVerification } from "./host-step.js";
import { missingPropertyVerdict } from "./property-presence.js";
import { propertyCallOf, propertyPathOf } from "./property-call.js";
import type { PropertyCall } from "./property-call.js";
import { verifyExpression } from "./property-expression.js";
import { verifyKeyframes } from "./property-keys.js";
import { verifyLayerValue } from "./property-value.js";
import { exactStep, failedStep, unverifiedStep } from "./verdicts.js";
import type { VerifiedStep } from "./verdicts.js";
import type { LayerState } from "./verify-context.js";

const REMOVED_LATER = "a later remove_effect in this plan removed this effect, so it is no longer on the layer to read back";

function hostEnabledVerdict(call: PropertyCall): VerifiedStep {
  const { state, where } = call;
  const { request, step } = state;
  const kind = request.operation;
  if (step.observedEnabled === undefined) return unverifiedStep(kind, "effect-enabled-state-not-in-snapshot", { ...where, ...hostVerification(step) });
  return step.observedEnabled === request.enabled ? exactStep(kind, "effect-enabled-host-readback", where) : failedStep(kind, "effect-enabled-mismatch", { ...where, observedEnabled: step.observedEnabled });
}

function verifyEffectEnabled(call: PropertyCall): VerifiedStep | null {
  const { state, property, where } = call;
  const { request } = state;
  if (request.enabled === undefined) return null;
  if (typeof property.enabled !== "boolean") return hostEnabledVerdict(call);
  return property.enabled === request.enabled ? exactStep(request.operation, "effect-enabled-state", where) : failedStep(request.operation, "effect-enabled-mismatch", where);
}

const PROPERTY_CHECKS: Readonly<Record<string, (call: PropertyCall) => VerifiedStep | null>> = {
  set_layer_property: verifyLayerValue,
  set_expression: verifyExpression,
  animate_property: verifyKeyframes,
  animate_control: verifyKeyframes,
  ensure_effect: verifyEffectEnabled,
};

/** The verdict for an operation on a property row, or null when it addresses no path. */
export function verifyPropertyOperation(state: LayerState): VerifiedStep | null {
  const path = propertyPathOf(state);
  if (!path) return null;
  const call = propertyCallOf(state, path);
  if (!call) return missingPropertyVerdict(state, path, REMOVED_LATER);
  const checked = PROPERTY_CHECKS[state.request.operation]?.(call);
  return checked ?? exactStep(state.request.operation, "property-path", call.where);
}

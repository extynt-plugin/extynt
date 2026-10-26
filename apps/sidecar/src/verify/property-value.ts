// The verdict for set_layer_property: the value read back against the value written, and how an enabled expression or a later re-parenting changes what that proves.
import { roundedValueText } from "./value-text.js";
import { propertyValueVerdict } from "./value-verdict.js";
import type { Reading } from "./compare-values.js";
import { compensatingParentIndex } from "./later-steps.js";
import type { PropertyCall } from "./property-call.js";
import { exactStep, failedStep, unverifiedStep } from "./verdicts.js";
import type { Details, VerifiedStep } from "./verdicts.js";
import { preApplyValue } from "./verify-context.js";

const EXPRESSION_OWNS_VALUE = "an enabled expression owns this property's visible value, so the read-back is the expression's output and says nothing about the static value written; the write is not disproved, and the expression itself is verified by its own row";

function valueEvidence(requested: Reading, observed: Reading): Details {
  const asked = roundedValueText(requested);
  const held = roundedValueText(observed);
  return { ...(asked === null ? {} : { expectedValue: asked }), ...(held === null ? {} : { observedValue: held }) };
}

function parentReason(index: number, tail: string): string {
  return `operation ${index} (set_layer_parent) ${tail}`;
}

function verifyBeforeParent(call: PropertyCall, parentIndex: number): VerifiedStep {
  const { state, where } = call;
  const kind = state.request.operation;
  const hostAfter = state.step.afterValue;
  const parent = { ...where, parentOperationIndex: parentIndex };
  if (hostAfter === undefined || hostAfter === null) return unverifiedStep(kind, "property-value-compensated-by-later-parent", { ...parent, reason: `the host reported no read right after the write; ${parentReason(parentIndex, "legitimately rewrites the local value")}` });
  const before = preApplyValue(state.ctx, where.compositionId, where.layerId, where.propertyPath);
  const applied = propertyValueVerdict(hostAfter, state.request.value, before);
  if (applied === "exact" || applied === "broadcast") return exactStep(kind, "property-value-applied-then-parent-compensated", { ...parent, observedValue: hostAfter, reason: parentReason(parentIndex, "keeps the layer's world position and rewrites its local value; the write is confirmed by the host's read right after it") });
  return failedStep(kind, "property-value-mismatch", { ...parent, ...valueEvidence(state.request.value, hostAfter) });
}

function mismatchVerdict(call: PropertyCall): VerifiedStep {
  const { state, property, where } = call;
  const parentIndex = compensatingParentIndex(state);
  if (parentIndex >= 0) return verifyBeforeParent(call, parentIndex);
  return failedStep(state.request.operation, "property-value-mismatch", { ...where, ...valueEvidence(state.request.value, property.value) });
}

/** The verdict for set_layer_property when the value read back is not exactly the one written; null when it is, so the path check stands. */
export function verifyLayerValue(call: PropertyCall): VerifiedStep | null {
  const { state, property, where } = call;
  const kind = state.request.operation;
  const before = preApplyValue(state.ctx, where.compositionId, where.layerId, where.propertyPath);
  const verdict = propertyValueVerdict(property.value, state.request.value, before);
  if (verdict === "exact") return null;
  if (property.expressionEnabled === true) return unverifiedStep(kind, "property-value-under-expression", { ...where, expressionEnabled: true, observedValue: property.value, reason: EXPRESSION_OWNS_VALUE });
  if (verdict === "mismatch") return mismatchVerdict(call);
  return unverifiedStep(kind, verdict === "coerced" ? "property-value-coerced" : "property-value-broadcast", where);
}

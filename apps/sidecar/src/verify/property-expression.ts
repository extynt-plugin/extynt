// The verdicts about expressions on a property: whether set_expression left the requested state and moves the value, and whether keyframes written under an expression still drive it.
import { array, boolean, decode, fallback, jsonValue, number, object, optional, string } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import { expressionProbe, expressionProbeResult } from "./expression-probe.js";
import { hostVerification, isKeyWriter } from "./host-step.js";
import type { HostStep } from "./host-step.js";
import type { PropertyCall } from "./property-call.js";
import { exactStep, failedStep, unverifiedStep } from "./verdicts.js";
import type { VerifiedStep } from "./verdicts.js";
import type { VerifyContext } from "./verify-context.js";

const expressionEvidence = object({
  expressionExistingKeys: optional(fallback(number(), undefined)),
  expressionSamples: optional(fallback(array(jsonValue), undefined)),
  expressionSampledError: optional(fallback(string(), undefined)),
  expressionChanges: optional(fallback(boolean(), undefined)),
  expressionProbe: optional(fallback(expressionProbe, undefined)),
  expressionEnabled: optional(fallback(boolean(), undefined)),
});

type ExpressionEvidence = Infer<typeof expressionEvidence>;

interface KeyExpressionState {
  readonly enabled: boolean;
  readonly referenced: string | null;
}

const evidenceByStep = new WeakMap<HostStep, ExpressionEvidence>();

function evidenceOf(step: HostStep): ExpressionEvidence {
  const known = evidenceByStep.get(step);
  if (known) return known;
  const decoded = decode(expressionEvidence, step.row);
  const evidence = decoded.ok ? decoded.value : {};
  evidenceByStep.set(step, evidence);
  return evidence;
}

function sameProperty(candidate: HostStep, step: HostStep, path: string | undefined): boolean {
  return candidate.compositionId === step.compositionId && candidate.layerId === step.layerId && candidate.propertyPath === path;
}

function hasKeysInPlan(call: PropertyCall, existingKeys: number | undefined): boolean {
  const { state, property } = call;
  if ((property.keyframeCount ?? 0) > 0 || (existingKeys ?? 0) > 0) return true;
  return state.ctx.steps.some((candidate) => isKeyWriter(candidate) && sameProperty(candidate, state.step, state.request.propertyPath));
}

function motionVerdict(call: PropertyCall, evidence: ExpressionEvidence): VerifiedStep {
  const { state, where } = call;
  const kind = state.request.operation;
  const sampledTimes = evidence.expressionSamples?.length ?? 0;
  if (evidence.expressionSampledError) return failedStep(kind, "expression-evaluation-error", { ...where, expressionError: evidence.expressionSampledError });
  const probed = expressionProbeResult(kind, state.request.source, evidence.expressionProbe, where);
  if (probed) return probed;
  if (sampledTimes < 2) return unverifiedStep(kind, "expression-motion-not-sampled", { ...where, sampledTimes, ...hostVerification(state.step) });
  if (evidence.expressionChanges === true) return exactStep(kind, "property-expression-motion", { ...where, sampledTimes, expressionChanges: true });
  if (hasKeysInPlan(call, evidence.expressionExistingKeys)) return unverifiedStep(kind, "expression-value-constant-not-motion", { ...where, sampledTimes, expressionChanges: false, reason: "the expression evaluated to the same value at every sampled time, so it does not animate this property" });
  return exactStep(kind, "property-expression-state", { ...where, sampledTimes, expressionChanges: false });
}

/** The verdict for set_expression: the property holds the requested expression state, and an enabled expression evaluates and moves as it should. */
export function verifyExpression(call: PropertyCall): VerifiedStep {
  const { state, property, where } = call;
  const { request } = state;
  const stateMatches = property.expressionEnabled === request.enabled && (request.enabled !== true || property.expression === request.source);
  if (!stateMatches) return failedStep(request.operation, "expression-state-mismatch", where);
  if (request.enabled !== true) return exactStep(request.operation, "property-expression-cleared", where);
  return motionVerdict(call, evidenceOf(state.step));
}

function keyExpressionState(ctx: VerifyContext, call: PropertyCall): KeyExpressionState {
  const { state, property } = call;
  let enabled = evidenceOf(state.step).expressionEnabled === true;
  let referenced: string | null = null;
  for (const candidate of ctx.steps) {
    if (candidate.operation !== "set_expression" || !sameProperty(candidate, state.step, state.request.propertyPath)) continue;
    enabled = candidate.verification === "expression-enabled";
    referenced = candidate.expressionKeysReferenced ?? null;
  }
  return { enabled: typeof property.expressionEnabled === "boolean" ? property.expressionEnabled : enabled, referenced };
}

/** The verdict for keyframes that read back as written, given any expression enabled on the same property. */
export function keyExpressionVerdict(call: PropertyCall, expectedKeys: number | null, observedKeys: number): VerifiedStep {
  const { state, where } = call;
  const kind = state.request.operation;
  const expression = keyExpressionState(state.ctx, call);
  if (!expression.enabled) return exactStep(kind, "property-keyframe-digest", { ...where, keyframes: observedKeys });
  if (expression.referenced === "ignored") return unverifiedStep(kind, "property-keyframes-superseded-by-expression", { ...where, expectedKeys, observedKeys, expressionEnabled: true, expressionKeysReferenced: "ignored", reason: "the enabled expression does not read these keyframes - it evaluated to the same value at every keyed time - so the keyed values do not drive this property" });
  if (expression.referenced === "referenced") return exactStep(kind, "property-keyframe-digest", { ...where, keyframes: observedKeys, expressionEnabled: true, expressionKeysReferenced: "referenced", expressionMotionUnverified: true, reason: "these keyframes are live inputs: the expression's evaluated value follows them at the keyed times. An expression also drives this property, so the resulting motion is not verified." });
  return unverifiedStep(kind, "property-keyframes-expression-keys-unknown", { ...where, expectedKeys, observedKeys, expressionEnabled: true, reason: "an expression is enabled on this property and the host could not tell whether it reads these keyframes, so the keyed values may or may not drive the result; the motion is not verified" });
}

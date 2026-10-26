// The verdict for animate_property and animate_control: the keyframe count and digest the host reported for the final write against the snapshot's row, then shape-key checks and any expression over the keys.
import { hostVerification, isKeyWriter } from "./host-step.js";
import type { HostStep } from "./host-step.js";
import type { PropertyCall } from "./property-call.js";
import { keyExpressionVerdict } from "./property-expression.js";
import { shapeKeyMismatch, shapeKeyValueMismatch } from "./shape-keys.js";
import { failedStep, unverifiedStep } from "./verdicts.js";
import type { VerifiedStep } from "./verdicts.js";

function finalKey<T>(steps: ReadonlyArray<HostStep>, step: HostStep, read: (candidate: HostStep) => T | undefined): T | null {
  let result: T | null = null;
  for (const candidate of steps) {
    const sameProperty = candidate.compositionId === step.compositionId && candidate.layerId === step.layerId && candidate.propertyPath === step.propertyPath;
    const value = isKeyWriter(candidate) && sameProperty ? read(candidate) : undefined;
    if (value !== undefined) result = value;
  }
  return result;
}

/** The key count the host reported after the last write to the step's property, or null when no write reported one. */
export function finalHostKeyCount(steps: ReadonlyArray<HostStep>, step: HostStep): number | null {
  return finalKey(steps, step, (candidate) => candidate.afterKeys);
}

/** The key digest the host reported after the last write to the step's property, or null when no write reported one. */
export function finalHostKeyDigest(steps: ReadonlyArray<HostStep>, step: HostStep): string | null {
  return finalKey(steps, step, (candidate) => candidate.afterDigest);
}

function countVerdict(call: PropertyCall, expectedKeys: number | null, observedKeys: number): VerifiedStep | null {
  const { state, where } = call;
  const kind = state.request.operation;
  if (expectedKeys === null || Boolean(state.request.expression)) return unverifiedStep(kind, "property-keyframes-not-in-snapshot", { ...where, ...hostVerification(state.step) });
  return observedKeys !== expectedKeys || observedKeys < 1 ? failedStep(kind, "keyframe-count-mismatch", { ...where, expectedKeys, observedKeys }) : null;
}

function digestVerdict(call: PropertyCall, expectedKeys: number | null, observedKeys: number): VerifiedStep | null {
  const { state, property, where } = call;
  const kind = state.request.operation;
  const expectedDigest = finalHostKeyDigest(state.ctx.steps, state.step);
  const observedDigest = property.keyDigest ?? null;
  if (expectedDigest === null || observedDigest === null) return unverifiedStep(kind, "property-keyframe-count-only", { ...where, expectedKeys, observedKeys, ...hostVerification(state.step) });
  if (property.keyDigestTruncated === true) return unverifiedStep(kind, "property-keyframes-truncated", { ...where, observedKeys });
  return expectedDigest === observedDigest ? null : failedStep(kind, "keyframe-digest-mismatch", { ...where, expectedKeys, observedKeys, expectedDigest, observedDigest });
}

function shapeKeyVerdict(call: PropertyCall): VerifiedStep | null {
  const { state, property, where } = call;
  const kind = state.request.operation;
  const count = shapeKeyMismatch(property, state.request);
  if (count) return failedStep(kind, "shape-key-vertex-count-mismatch", { ...where, time: count.time, expectedVertices: count.expected, observedVertices: count.observed });
  const value = shapeKeyValueMismatch(state.step, state.request);
  return value ? failedStep(kind, "shape-key-value-mismatch", { ...where, time: value.time, field: value.field }) : null;
}

/** The verdict for keyframes written by animate_property or animate_control. */
export function verifyKeyframes(call: PropertyCall): VerifiedStep {
  const { state, property } = call;
  const expectedKeys = finalHostKeyCount(state.ctx.steps, state.step);
  const observedKeys = property.keyframeCount ?? 0;
  const counted = countVerdict(call, expectedKeys, observedKeys);
  if (counted) return counted;
  const checked = digestVerdict(call, expectedKeys, observedKeys) ?? shapeKeyVerdict(call);
  return checked ?? keyExpressionVerdict(call, expectedKeys, observedKeys);
}

// The verdict for add/update_text_animator and add/update_shape_item: the container exists, the host's read of every written property matches, and the snapshot holds each property that no later step overwrote.
import { sameControlValue } from "./compare-values.js";
import { hostCheckedSpecs, hostSpecMismatch } from "./spec-readback.js";
import type { CheckedSpec } from "./spec-readback.js";
import { STRUCTURED_KINDS } from "./plan-kinds.js";
import { propertyOf } from "./verify-context.js";
import type { LayerState } from "./verify-context.js";
import type { SnapshotProperty } from "./snapshot-reply.js";
import { exactStep, failedStep, unverifiedStep } from "./verdicts.js";
import type { VerifiedStep } from "./verdicts.js";

function specOverwritten(state: LayerState, spec: CheckedSpec): boolean {
  const { ctx, step, index } = state;
  return ctx.steps.slice(index + 1).some((later) => {
    if (later.compositionId !== step.compositionId || later.layerId !== step.layerId) return false;
    return [...(later.writes ?? []), ...(later.animations ?? [])].some((candidate) => candidate.path === spec.path);
  });
}

function specMismatch(property: SnapshotProperty, spec: CheckedSpec): string | null {
  if (spec.afterKeys !== undefined) return property.keyframeCount === spec.afterKeys ? null : "keyframe-count-mismatch";
  return sameControlValue(property.value, spec.value) ? null : "spec-value-mismatch";
}

function specVerdict(state: LayerState, spec: CheckedSpec): VerifiedStep | null {
  const kind = state.request.operation;
  const where = { compositionId: state.comp.id, layerId: state.layer.id };
  const property = propertyOf(state.layer, spec.path);
  if (!property) return spec.hostMatched === true ? null : unverifiedStep(kind, "spec-path-not-in-snapshot", { ...where, propertyPath: spec.path ?? null });
  const basis = specMismatch(property, spec);
  return basis === null ? null : failedStep(kind, basis, { ...where, propertyPath: spec.path ?? null, observedValue: property.value });
}

function firstSpecFault(state: LayerState, current: ReadonlyArray<CheckedSpec>): VerifiedStep | null {
  for (const spec of current) {
    const verdict = specVerdict(state, spec);
    if (verdict) return verdict;
  }
  return null;
}

function structuredWrite(state: LayerState): boolean {
  const { request, step } = state;
  return STRUCTURED_KINDS.has(request.operation) && (step.writes !== undefined || step.animations !== undefined);
}

function exactBasis(current: ReadonlyArray<CheckedSpec>, all: ReadonlyArray<CheckedSpec>): string {
  if (current.length > 0) return "structure-and-values";
  return all.length > 0 ? "structure-values-superseded" : "structure-exists";
}

/** The verdict for a structured write, or null when the operation is not one or the host reported no spec lists. */
export function verifyStructured(state: LayerState): VerifiedStep | null {
  const { request, step, layer } = state;
  const kind = request.operation;
  if (!structuredWrite(state)) return null;
  const where = { compositionId: state.comp.id, layerId: layer.id };
  if (step.containerPath && !propertyOf(layer, step.containerPath)) return failedStep(kind, "container-path-missing", { ...where, propertyPath: step.containerPath });
  const specs = hostCheckedSpecs(request, step);
  const hostMismatch = hostSpecMismatch(kind, specs, where);
  if (hostMismatch) return hostMismatch;
  const current = specs.filter((spec) => !specOverwritten(state, spec));
  const fault = firstSpecFault(state, current);
  if (fault) return fault;
  if (!step.containerPath) return unverifiedStep(kind, "container-path-unknown", where);
  return exactStep(kind, exactBasis(current, specs), { ...where, propertyPath: step.containerPath });
}

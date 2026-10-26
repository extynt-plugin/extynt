// The verdicts for layer operations judged mostly by what the host reported: apply_preset, ensure_text_animator, the shape read-backs and the evidence-only fallback.
import { array, boolean, decode, fallback, jsonObject, jsonValue, number, object, optional } from "@extynt/decode";
import { sameControlValue } from "./compare-values.js";
import { hostVerification } from "./host-step.js";
import { objectOf } from "./json-fields.js";
import { shapeMismatchEvidence, shapeReadbackMatches } from "./shape-readback.js";
import { exactStep, failedStep, unverifiedStep } from "./verdicts.js";
import type { Details, VerifiedStep } from "./verdicts.js";
import { layerWhere, propertyOf } from "./verify-context.js";
import type { LayerState } from "./verify-context.js";

const TEXT_ANIMATOR_TOLERANCE = 0.0001;
const EFFECT_PARADE = "ADBE Effect Parade/";

const presetRead = object({ after: optional(fallback(object({ effects: optional(fallback(array(jsonValue), undefined)) }), undefined)), changed: optional(fallback(boolean(), undefined)), added: optional(fallback(jsonValue, undefined)) });
const animatorRead = object({ animatorCount: optional(fallback(number(), undefined)) });
const shapeRead = object({ readback: optional(fallback(jsonObject, undefined)) });

function effectCount(state: LayerState): number {
  return (state.layer.propertyPaths ?? []).filter((row) => row.path?.startsWith(EFFECT_PARADE) === true && row.path.split("/").length === 2).length;
}

/** The verdict for apply_preset: the effects the host saw added against the effects in the fresh read. */
export function verifyPreset(state: LayerState): VerifiedStep {
  const kind = state.request.operation;
  const where = layerWhere(state);
  const decoded = decode(presetRead, state.step.row);
  const read = decoded.ok ? decoded.value : {};
  if (!read.after) return unverifiedStep(kind, "preset-host-summary-missing", where);
  const added = read.added || null;
  if (!read.changed) return unverifiedStep(kind, "preset-no-observable-change", { ...where, added });
  const observedEffects = effectCount(state);
  const hostEffects = read.after.effects?.length ?? -1;
  if (observedEffects === hostEffects) return exactStep(kind, "preset-effects-observed", { ...where, added });
  return unverifiedStep(kind, "preset-structure-not-fully-in-snapshot", { ...where, added, observedEffects, hostEffects });
}

function animatorOutcome(state: LayerState, observed: number | undefined): VerifiedStep["basis"] {
  const wanted = state.request.value;
  const close = typeof wanted === "number" && observed !== undefined && Math.abs(observed - wanted) < TEXT_ANIMATOR_TOLERANCE;
  return close ? "text-animator-host-readback" : "text-animator-not-observed";
}

function animatorEvidence(state: LayerState): Details {
  const { step } = state;
  const decoded = decode(animatorRead, step.row);
  const animatorCount = decoded.ok ? (decoded.value.animatorCount ?? null) : null;
  return { ...layerWhere(state), propertyPath: step.propertyPath ?? null, observedValue: step.observedValue ?? null, animatorCount, created: step.created === true };
}

/** The verdict for ensure_text_animator: the animator's leaf property in the fresh read, else the value the host read when it set it. */
export function verifyTextAnimator(state: LayerState): VerifiedStep {
  const { request, step } = state;
  const kind = request.operation;
  const leaf = step.propertyPath ? propertyOf(state.layer, step.propertyPath) : null;
  const evidence = animatorEvidence(state);
  if (leaf && !sameControlValue(leaf.value, request.value)) return failedStep(kind, "text-animator-value-mismatch", { ...evidence, observedValue: leaf.value ?? null });
  if (leaf) return exactStep(kind, "text-animator-value", evidence);
  const basis = animatorOutcome(state, typeof step.observedValue === "number" ? step.observedValue : undefined);
  return basis === "text-animator-host-readback" ? exactStep(kind, basis, evidence) : failedStep(kind, basis, evidence);
}

/** The verdict for the shape operations: the host's read of the shape group against what the plan asked for. */
export function verifyShapeReadback(state: LayerState): VerifiedStep {
  const { request, step } = state;
  const kind = request.operation;
  const decoded = decode(shapeRead, step.row);
  const readback = decoded.ok ? decoded.value.readback : undefined;
  const matched = shapeReadbackMatches(kind, request, readback);
  const details = { ...layerWhere(state), ...hostVerification(step), renderedBounds: objectOf(readback?.bounds) ?? null };
  if (matched === null) return unverifiedStep(kind, "shape-host-readback-unavailable", details);
  return matched ? exactStep(kind, "shape-host-readback", details) : failedStep(kind, "shape-host-readback-mismatch", { ...details, ...shapeMismatchEvidence(kind, request, readback) });
}

/** The verdict for detect_scene_edits and every kind the fresh read cannot judge: applied, with the host's own check named. */
export function verifyEvidenceOnly(state: LayerState): VerifiedStep {
  const { ctx, request, step } = state;
  const prefix = `${state.compId ?? ""}:${request.layerId ?? ""}:`;
  const mask = request.newMaskId || request.maskId;
  const group = request.newGroupId || request.groupId;
  const placeholderObserved = ctx.ids.masks.has(prefix + (mask ?? "")) || ctx.ids.groups.has(prefix + (group ?? ""));
  return unverifiedStep(request.operation, "host-step-evidence-state-not-in-snapshot", { ...layerWhere(state), ...hostVerification(step), placeholderObserved });
}

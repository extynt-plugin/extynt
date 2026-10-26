/**
 * Fake After Effects host loaders and payload builders for the apply_plan suites.
 * The fake host model and each loader live in their own host-* module; this module re-exports them with the small plan helpers.
 */

import { maskParadeOf } from "./host-fake-lookup.js";
import { type PlanApply, TITLE_TARGET, applyPlan } from "./host-plan-io.js";
import { type JsonObject, type JsonValue } from "@extynt/decode";
import type { FakeMaskParade } from "./host-fake-groups.js";
import type { FakeLayer } from "./host-fake-comp.js";

export { FAKE_ALPHA_MODE, FAKE_FIELD_SEPARATION, FakeAddGroup, FakeCompItem, FakeEffectParade, FakeFolderItem, FakeFootageItem, FakeFootageSource, FakeLayer, FakeMaskParade, FakeProperty, FakeShape, FakeShapeContents, FakeShapeRoot, FakeTextAnimator, FakeTextAnimatorProperties, FakeTextAnimators, FakeTextSelectors, withFreshTextDocuments } from "./host-apply-host.js";
export { loadApplyPlan } from "./host-apply-load.js";
export type { ApplyPlanOptions } from "./host-apply-svg.js";
export { loadCaptureAdapters } from "./host-apply-capture.js";
export { TRACK_MATTE_MEMBERS, loadSnapshotProbe } from "./host-apply-snapshot.js";
export { fakeAnimator, leaf, loadExtended } from "./host-apply-extended.js";

/** The property path of a layer's Position. */
export const POSITION_PATH = "ADBE Transform Group/ADBE Position";

/** Replaces the mask parade of `shapeLayer` content with one empty mask per name and returns the parade. */
export function namedMaskParade(shapeLayer: FakeLayer, names: readonly string[]): FakeMaskParade {
  const parade = maskParadeOf(shapeLayer);
  parade.children.length = 0;
  for (const name of names) {
    const mask = parade.addProperty("ADBE Mask Atom");
    if (mask) mask.name = name;
  }
  return parade;
}

/** The names of the masks in `parade`, in order. */
export function maskNames(parade: FakeMaskParade): string[] {
  return parade.children.map((mask) => mask.name);
}

/** The value of the named mask's opacity property. */
export function maskOpacity(parade: FakeMaskParade, name: string) {
  const mask = parade.children.find((candidate) => candidate.name === name);
  return mask?.children.find((child) => child.matchName === "ADBE Mask Opacity")?.value;
}

/** An animate_property operation on the title layer's Position with `keyframes`, plus any `extra` fields. */
export function animatePosition(keyframes: readonly JsonValue[], extra: JsonObject = {}): JsonObject {
  return { operation: "animate_property", ...TITLE_TARGET, propertyPath: POSITION_PATH, role: "transform.position", keyframes, ...extra };
}

/** Applies a plan of `operations` under the plan id the extended-host suites share and returns the parsed host reply. */
export function run(apply: PlanApply, operations: readonly JsonValue[]): JsonObject {
  return applyPlan(apply, "extended", operations);
}

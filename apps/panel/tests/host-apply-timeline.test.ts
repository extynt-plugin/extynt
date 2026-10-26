/** Apply-plan host contract: composition-level timeline settings and markers, applied by the real host jsx against the fake composition. */

import assert from "node:assert/strict";
import test from "node:test";
import { loadApplyPlan } from "./host-apply-harness.js";
import { applyPlan, assertApplied } from "./host-plan-io.js";
import { fieldOf, plain, textAt } from "./json-narrow.js";
import type { FakeValue } from "./host-fake-property.js";
import { type JsonObject, type JsonValue } from "@extynt/decode";

const OUT_OF_RANGE_SETTINGS: ReadonlyArray<JsonObject> = [
  { shutterAngle: 721 },
  { shutterPhase: 400 },
  { motionBlurSamplesPerFrame: 1 },
  { motionBlurSamplesPerFrame: 4.5 },
  { motionBlurAdaptiveSampleLimit: 300 },
  { motionBlur: "on" },
  { workAreaDuration: 0 },
];

function compositionSettings(settings: JsonValue) {
  return { operation: "set_composition_settings", compositionId: "comp-main", settings };
}

function commentOf(keyValue: FakeValue | undefined): string {
  return textAt(plain(keyValue), "comment");
}

test("apply_plan writes the work area, motion blur, shutter and renderer fields", () => {
  const { apply, comp } = loadApplyPlan();
  const settings = { workAreaStart: 2, workAreaDuration: 5, motionBlur: true, shutterAngle: 270, shutterPhase: -45, motionBlurSamplesPerFrame: 32, motionBlurAdaptiveSampleLimit: 200, renderer: "Advanced 3D" };
  assertApplied(applyPlan(apply, "timeline", [compositionSettings(settings)]));
  assert.deepEqual([comp.workAreaStart, comp.workAreaDuration, comp.motionBlur, comp.shutterAngle, comp.shutterPhase], [2, 5, true, 270, -45]);
  assert.deepEqual([comp.motionBlurSamplesPerFrame, comp.motionBlurAdaptiveSampleLimit, comp.renderer], [32, 200, "Advanced 3D"]);
});

test("apply_plan moves the work area right and left without leaving the composition", () => {
  const { apply, comp } = loadApplyPlan();
  comp.workAreaStart = 0;
  comp.workAreaDuration = 4;
  assertApplied(applyPlan(apply, "wa-right", [compositionSettings({ workAreaStart: 8, workAreaDuration: 2 })]));
  assert.deepEqual([comp.workAreaStart, comp.workAreaDuration], [8, 2]);
  assertApplied(applyPlan(apply, "wa-left", [compositionSettings({ workAreaStart: 1, workAreaDuration: 3 })]));
  assert.deepEqual([comp.workAreaStart, comp.workAreaDuration], [1, 3]);
});

test("apply_plan refuses a renderer the composition does not list and out-of-range timeline values", () => {
  const { apply, comp } = loadApplyPlan();
  const renderer = applyPlan(apply, "renderer-bad", [compositionSettings({ renderer: "Cinema 4D" })]);
  assert.equal(fieldOf(renderer, "ok"), false);
  assert.equal(fieldOf(renderer, "error", "code"), "INVALID_VALUE");
  assert.equal(comp.renderer, "Classic 3D");
  for (const settings of OUT_OF_RANGE_SETTINGS) {
    const refused = applyPlan(apply, "bound-bad", [compositionSettings(settings)]);
    assert.equal(fieldOf(refused, "ok"), false, JSON.stringify(settings));
    assert.equal(fieldOf(refused, "error", "code"), "INVALID_VALUE", JSON.stringify(settings));
  }
  assert.equal(comp.shutterAngle, 180);
});

test("apply_plan adds, updates and removes a composition marker without naming a layer", () => {
  const { apply, comp } = loadApplyPlan();
  assertApplied(applyPlan(apply, "cm-add", [{ operation: "add_marker", compositionId: "comp-main", time: 1.5, comment: "Cut", label: 2 }]));
  assert.equal(comp.markerProperty.numKeys, 1);
  assert.equal(commentOf(comp.markerProperty.keyValue(1)), "Cut");
  assertApplied(applyPlan(apply, "cm-update", [{ operation: "update_marker", compositionId: "comp-main", time: 1.5, comment: "Cut hard" }]));
  assert.equal(comp.markerProperty.numKeys, 1);
  assert.equal(commentOf(comp.markerProperty.keyValue(1)), "Cut hard");
  assertApplied(applyPlan(apply, "cm-remove", [{ operation: "remove_marker", compositionId: "comp-main", time: 1.5, destructive: true }]));
  assert.equal(comp.markerProperty.numKeys, 0);
});

test("apply_plan refuses a composition marker on a missing composition and a duplicate add", () => {
  const { apply, comp } = loadApplyPlan();
  const missing = applyPlan(apply, "cm-missing", [{ operation: "add_marker", compositionId: "comp-nope", time: 1, comment: "x" }]);
  assert.equal(fieldOf(missing, "ok"), false);
  const first = applyPlan(apply, "cm-first", [{ operation: "add_marker", compositionId: "comp-main", time: 1, comment: "a" }]);
  assert.equal(fieldOf(first, "ok"), true);
  const again = applyPlan(apply, "cm-again", [{ operation: "add_marker", compositionId: "comp-main", time: 1, comment: "b" }]);
  assert.equal(fieldOf(again, "ok"), false);
  assert.equal(comp.markerProperty.numKeys, 1);
});

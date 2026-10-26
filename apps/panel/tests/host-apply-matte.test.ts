/**
 * Apply-plan host contract: layer ordering and track mattes, and how the snapshot reads After Effects' numeric matte types.
 * The fake host and payload builders live in host-apply-harness.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { TRACK_MATTE_MEMBERS, loadApplyPlan, loadSnapshotProbe } from "./host-apply-harness.js";
import { layerAt } from "./host-fake-lookup.js";
import { TITLE_TARGET, applyPlan, assertApplied, assertRefused } from "./host-plan-io.js";
import { fieldOf, optionalTextAt, textAt } from "./json-narrow.js";
import { type JsonObject } from "@extynt/decode";

function matteOperation(extra: JsonObject = {}): JsonObject {
  return { operation: "set_track_matte", ...TITLE_TARGET, matteLayerId: "layer-shape", mode: "alpha", ...extra };
}

test("apply_plan uses fixed layer ordering and track-matte APIs, including clear", () => {
  const { apply, comp, title, shapeLayer } = loadApplyPlan();
  const result = applyPlan(apply, "layer-order-1", [
    { operation: "reorder_layer", compositionId: "comp-main", layerId: "layer-shape", placement: "beginning" },
    { operation: "reorder_layer", ...TITLE_TARGET, placement: "after", referenceLayerId: "layer-shape" },
    matteOperation(),
  ]);
  assertApplied(result);
  assert.equal(layerAt(comp, 0), shapeLayer);
  assert.equal(layerAt(comp, 1), title);
  assert.deepEqual(title.trackMatte, { layer: shapeLayer, type: "alpha" });
  const clear = applyPlan(apply, "layer-order-2", [matteOperation({ matteLayerId: null })]);
  assertApplied(clear);
  assert.equal(title.trackMatte, null);
});

test("setTrackMatte hides the matte source like After Effects; the step says so unless showMatteLayer keeps it rendering", () => {
  const hidden = loadApplyPlan();
  const left = applyPlan(hidden.apply, "matte-hidden", [matteOperation()]);
  assertApplied(left);
  assert.equal(hidden.shapeLayer.enabled, false);
  assert.equal(fieldOf(left, "steps", 0, "matteSourceEnabled"), false);
  assert.match(textAt(left, "steps", 0, "matteSourceNote"), /is hidden \(After Effects hides a layer used as a matte\); showMatteLayer: true keeps it rendering/);
  const shown = loadApplyPlan();
  const kept = applyPlan(shown.apply, "matte-shown", [matteOperation({ showMatteLayer: true })]);
  assert.equal(fieldOf(kept, "ok"), true, optionalTextAt(kept, "error", "message"));
  assert.equal(shown.shapeLayer.enabled, true);
  assert.equal(fieldOf(kept, "steps", 0, "matteSourceEnabled"), true);
  assert.equal(fieldOf(kept, "steps", 0, "matteSourceNote"), undefined);
});

test("showMatteLayer fails loudly when the host refuses the visibility write", () => {
  const { apply, shapeLayer } = loadApplyPlan();
  Object.defineProperty(shapeLayer, "enabled", {
    get: () => false,
    set: (value: boolean) => {
      if (value) throw new Error("locked");
    },
  });
  const result = applyPlan(apply, "matte-refused", [matteOperation({ showMatteLayer: true })]);
  assert.equal(fieldOf(result, "ok"), false);
  assert.match(textAt(result, "error", "message") + textAt(result, "error", "code"), /PROPERTY_WRITE_FAILED/);
});

test("legacy track mattes require an explicit reorder and then accept the adjacent matte", () => {
  const { apply, comp, title, shapeLayer } = loadApplyPlan();
  Object.defineProperty(title, "setTrackMatte", { value: undefined });
  assertRefused(applyPlan(apply, "legacy-matte-order", [matteOperation()]), "TRACK_MATTE_UNSUPPORTED");
  const ordered = applyPlan(apply, "legacy-matte-ordered", [
    { operation: "reorder_layer", compositionId: "comp-main", layerId: "layer-shape", placement: "before", referenceLayerId: "layer-title" },
    matteOperation(),
  ]);
  assert.equal(fieldOf(ordered, "ok"), true, optionalTextAt(ordered, "error", "message"));
  assert.equal(comp.layerItems.indexOf(shapeLayer) + 1, title.index - 1);
  assert.equal(title.trackMatteType, "alpha");
});

test("apply_plan rejects missing and self-referential layer order/matte targets before mutation", () => {
  const { apply } = loadApplyPlan();
  const missing = applyPlan(apply, "bad-order", [{ operation: "reorder_layer", ...TITLE_TARGET, placement: "before", referenceLayerId: "missing" }]);
  assertRefused(missing, "TARGET_NOT_FOUND");
  const selfMatte = applyPlan(apply, "bad-matte", [matteOperation({ matteLayerId: "layer-title" })]);
  assertRefused(selfMatte, "TARGET_NOT_FOUND");
});

test("the snapshot maps the live AE 26.2.1 numeric trackMatteType to the documented matte modes", () => {
  const { read } = loadSnapshotProbe();
  const expected: ReadonlyArray<readonly [number, string]> = [[5013, "alpha"], [5014, "alpha-inverted"], [5015, "luma"], [5016, "luma-inverted"]];
  for (const [value, mode] of expected) {
    const layer = read(value, true);
    assert.equal(fieldOf(layer, "matteType"), mode, `trackMatteType ${value} must report ${mode}`);
    assert.equal(fieldOf(layer, "matteLayerId"), "50", `trackMatteType ${value} must name the matte layer`);
  }
});

test("a cleared matte reports none even though AE leaves trackMatteType at its last mode", () => {
  const { read } = loadSnapshotProbe();
  const cleared = read(TRACK_MATTE_MEMBERS.LUMA_INVERTED, false);
  assert.equal(fieldOf(cleared, "matteType"), "none");
  assert.equal(fieldOf(cleared, "matteLayerId"), null);
  const neverMatted = read(TRACK_MATTE_MEMBERS.NO_TRACK_MATTE, false);
  assert.equal(fieldOf(neverMatted, "matteType"), "none");
  assert.equal(fieldOf(neverMatted, "matteLayerId"), null);
});

test("the snapshot's matteLayerId is the matte layer's persistent id, not its index", () => {
  const { read, addLayerAbove, matte } = loadSnapshotProbe();
  const first = read(TRACK_MATTE_MEMBERS.ALPHA, true);
  assert.equal(fieldOf(first, "matteLayerId"), String(matte.id));
  assert.equal(matte.index, 1);
  addLayerAbove("Inserted");
  const second = read(TRACK_MATTE_MEMBERS.ALPHA, true);
  assert.equal(fieldOf(second, "matteLayerId"), "50");
  assert.equal(matte.index, 2);
  assert.notEqual(fieldOf(second, "matteLayerId"), String(matte.index));
});

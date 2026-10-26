/** Frame checks after an apply: the host measures placed layers through a probe layer and reports only what it could measure. After Effects evaluates the expressions; the fake host cannot, so a measurement it cannot make must not break or fail the apply. */
import assert from "node:assert/strict";
import test from "node:test";
import { FakeLayer, FakeProperty } from "./host-apply-host.js";
import { loadApplyPlan } from "./host-apply-harness.js";
import { applyPlan, assertApplied } from "./host-plan-io.js";
import { evaluateJson } from "./host-vm-context.js";
import { fieldOf } from "./json-narrow.js";

type Loaded = ReturnType<typeof loadApplyPlan>;

const SHORTEN_TITLE = { operation: "set_layer_timing", compositionId: "comp-main", layerId: "layer-title", inPoint: 0, outPoint: 2 };

function visibleAt(loaded: Loaded, layer: FakeLayer, time: number): boolean {
  Object.assign(loaded.context, { probedLayer: layer });
  return evaluateJson(loaded.context, `aeFrameVisibleAt(probedLayer, ${time})`) === true;
}

function drawsPixels(loaded: Loaded, layer: FakeLayer): boolean {
  Object.assign(loaded.context, { probedLayer: layer });
  return evaluateJson(loaded.context, "aeFrameDrawsPixels(probedLayer)") === true;
}

function withOpacity(layer: FakeLayer, keys: ReadonlyArray<readonly [number, number]>): FakeLayer {
  const opacity = new FakeProperty("ADBE Opacity", "Opacity", [], keys[0]?.[1] ?? 100, true);
  for (const [time, opacityValue] of keys) opacity.setValueAtTime(time, opacityValue);
  layer.properties.push(new FakeProperty("ADBE Transform Group", "Transform", [opacity], null, false));
  return layer;
}

function matteLayer(type: string | null): FakeLayer {
  const layer = new FakeLayer("bar", []);
  if (type) layer.trackMatteType = type;
  return layer;
}

test("an apply whose placed layers cannot be measured still succeeds, and reports no frame rows", () => {
  const loaded = loadApplyPlan();
  const result = applyPlan(loaded.apply, "frame-1", [SHORTEN_TITLE]);
  assertApplied(result);
  const rows = fieldOf(result, "frameChecks");
  assert.ok(rows === undefined || (Array.isArray(rows) && rows.length === 0), JSON.stringify(rows));
});

test("the probe layer never outlives the apply", () => {
  const loaded = loadApplyPlan();
  applyPlan(loaded.apply, "frame-1", [SHORTEN_TITLE]);
  assert.ok(loaded.comp.layerItems.every((layer) => !/frame probe/i.test(layer.name)));
});

test("a sample at which the layer's opacity is 0 is not visible, one with opacity above 0 is", () => {
  const loaded = loadApplyPlan();
  const sweep = withOpacity(new FakeLayer("sweep", []), [[3, 100], [3.05, 0]]);
  assert.equal(visibleAt(loaded, sweep, 3), true);
  assert.equal(visibleAt(loaded, sweep, 5), false);
});

test("a layer whose opacity cannot be read counts as visible", () => {
  const loaded = loadApplyPlan();
  assert.equal(visibleAt(loaded, new FakeLayer("bare", []), 1), true);
});

test("a layer under an alpha or luma matte is not measured; inverted mattes and plain layers still are", () => {
  const loaded = loadApplyPlan();
  assert.equal(drawsPixels(loaded, matteLayer(null)), true);
  assert.equal(drawsPixels(loaded, matteLayer("alpha")), false);
  assert.equal(drawsPixels(loaded, matteLayer("luma")), false);
  assert.equal(drawsPixels(loaded, matteLayer("alpha-inverted")), true);
  assert.equal(drawsPixels(loaded, matteLayer("luma-inverted")), true);
  assert.equal(drawsPixels(loaded, matteLayer("no-track-matte")), true);
});

test("a layer serving as a visible track matte is still judged: since AE 23 a matte source keeps rendering unless its video is off", () => {
  const loaded = loadApplyPlan();
  const layer = new FakeLayer("matte-source", []);
  Object.assign(layer, { isTrackMatte: true });
  assert.equal(drawsPixels(loaded, layer), true);
  Object.assign(layer, { enabled: false });
  assert.equal(drawsPixels(loaded, layer), false);
});

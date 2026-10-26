// The v0.2 plan envelope: bounds, unknown fields, and the ids a refusal may name.
import assert from "node:assert/strict";
import test from "node:test";
import { representativeSnapshot, type ProjectSnapshot } from "@extynt/project-graph";
import { type JsonObject } from "@extynt/decode";
import { BLUR_CONTROL_PATH, BLUR_EFFECT_PATH, EMPTY_SNAPSHOT, footageTarget, newComposition, newTarget, newTextLayer, POSITION_PATH, target } from "./fixtures.js";
import { assertSequences, GENEROUS_BOUNDS, refusal } from "./plan-builders.js";

const ensureBlur = { type: "ensure_effect", target: { ...target, effectPath: BLUR_EFFECT_PATH }, capabilityId: "adobe.gaussian-blur", effectMatchName: "ADBE Gaussian Blur 2", effectPath: BLUR_EFFECT_PATH } satisfies JsonObject;

function renameIn(compositionId: string, layerId = target.layerId): JsonObject {
  return { type: "set_layer_name", target: { ...target, compositionId, layerId }, name: "x" };
}

function manyCompositions(): ProjectSnapshot {
  const [template] = representativeSnapshot.compositions;
  const [layerTemplate] = template?.layers ?? [];
  if (template === undefined || layerTemplate === undefined) assert.fail("the representative snapshot holds a layer");
  const layers = Array.from({ length: 30 }, (_, index) => ({ ...layerTemplate, id: `layer-${index}`, name: `Layer ${index}` }));
  return { ...representativeSnapshot, compositions: Array.from({ length: 30 }, (_, index) => ({ ...template, id: `comp-${index}`, name: `Comp ${index}`, layers })) };
}

test("a bounded multi-operation plan reaches the expression check with exact nested paths", () => {
  const animateBlur = { type: "animate_control", target: { ...target, effectPath: BLUR_EFFECT_PATH, propertyPath: BLUR_CONTROL_PATH }, role: "blur.amount", effectMatchName: "ADBE Gaussian Blur 2", keyframes: [{ time: 0, value: 0 }, { time: 1, value: 24 }], expression: { source: "time * 2", enabled: false } } satisfies JsonObject;
  const animatePosition = { type: "animate_property", target: { ...target, propertyPath: POSITION_PATH }, role: "transform.position", keyframes: [{ time: 0, value: [960, 540] }, { time: 1, value: [980, 540], interpolation: { outType: "EASE_OUT" } }] } satisfies JsonObject;
  const fields = { preconditions: ["selected layer is unchanged"], postconditions: ["blur and position animation are observable"] };
  const result = refusal([ensureBlur, animateBlur, animatePosition], { bounds: { maxOperations: 3, maxKeyframes: 4, maxExpressionLength: 128 }, fields });
  assert.equal(result.code, "EXPRESSIONS_UNSUPPORTED");
});

test("a target composition the snapshot does not hold names the ids that would have been accepted", () => {
  const result = refusal([renameIn("comp-mian")], { bounds: GENEROUS_BOUNDS });
  assert.equal(result.code, "TARGET_NOT_FOUND");
  assert.match(result.message, /comp-main "Main"/);
  assert.match(result.message, /comp-square "Social"/);
  assert.match(result.message, /The active composition is comp-main/);
});

test("a target layer the snapshot does not hold names the layers that would have been accepted", () => {
  const result = refusal([renameIn("comp-main", "__new__:missing")], { bounds: GENEROUS_BOUNDS });
  assert.equal(result.code, "TARGET_NOT_FOUND");
  assert.match(result.message, /layer-title "TITLE/);
  assert.match(result.message, /layer-footage "Plate" \(av, index 2\)/);
});

test("a planned composition names the placeholder an earlier create_layer lands on", () => {
  const options = { snapshot: EMPTY_SNAPSHOT, bounds: GENEROUS_BOUNDS };
  const layer = refusal([newComposition, newTextLayer, { type: "set_layer_name", target: newTarget({ layerId: "__new__:layer9" }), name: "x" }], options);
  assert.equal(layer.code, "TARGET_NOT_FOUND");
  assert.match(layer.message, /__new__:comp0 "Credits Roll" \(created earlier in this plan\)/);
  assert.match(layer.message, /This plan creates: __new__:layer1/);
  const composition = refusal([newComposition, { type: "set_layer_name", target: newTarget({ compositionId: "__new__:comp9" }), name: "x" }], options);
  assert.match(composition.message, /Compositions: none\. This plan creates: __new__:comp0 "Credits Roll"\./);
});

test("the refusal names the first ids and counts the rest", () => {
  const snapshot = manyCompositions();
  assert.match(refusal([renameIn("comp-mian")], { snapshot, bounds: GENEROUS_BOUNDS }).message, /… 10 more/);
  assert.match(refusal([renameIn("comp-0", "__new__:missing")], { snapshot, bounds: GENEROUS_BOUNDS }).message, /… 6 more/);
});

test("an unknown top-level field names the fields the operation accepts", () => {
  const marker = refusal([{ type: "add_marker", target, action: "add_marker", time: 0, comment: "Beat" }], { bounds: GENEROUS_BOUNDS });
  assert.equal(marker.code, "UNKNOWN_FIELD");
  assert.match(marker.message, /at the top level of add_marker/);
  assert.match(marker.message, /Fields it accepts at the top level: type, target, time, comment, duration, chapter, url, cuePointName, label\./);
});

test("a layer id beside the target is told to move inside it", () => {
  const hedged = refusal([{ type: "set_layer_name", target, name: "x", layerId: target.layerId }], { bounds: GENEROUS_BOUNDS });
  assert.match(hedged.message, /this object takes it inside target, where it already is\. Remove the top-level copy\./);
  assert.match(hedged.message, /Fields it accepts at the top level: type, target, name\./);
});

test("a nested non-operation object is judged by its own field list", () => {
  const selector = refusal([{ type: "add_text_animator", target, newAnimatorId: "__new__:anim1", properties: { opacity: 50 }, selector: { type: "range", bogus: true } }], { bounds: GENEROUS_BOUNDS });
  assert.match(selector.message, /at the top level of range/);
  assert.match(selector.message, /Fields it accepts at the top level: type, settings, amountExpression\./);
});

test("a plan refuses unknown plan fields and declared bounds", () => {
  const operations = [ensureBlur, ensureBlur];
  assert.equal(refusal(operations, { bounds: { maxOperations: 1 }, fields: { unknown: true } }).code, "UNKNOWN_FIELD");
  assert.equal(refusal(operations, { bounds: { maxOperations: 1 } }).code, "BOUNDS_EXCEEDED");
});

test("a plan batch-renames several layers in one operation set", () => {
  const rows = [["ok", [{ type: "set_layer_name", target, name: "Title_01" }, { type: "set_layer_name", target: footageTarget, name: "Footage_01" }]]] as const;
  assertSequences(rows);
});

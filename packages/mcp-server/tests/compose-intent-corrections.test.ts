// Tests for compose intent corrections.
import test from "node:test";
import assert from "node:assert/strict";
import { correctOperation, correctOperations } from "../src/compose-corrections.js";
import { asObject, booleanAt, objectAt, stringAt } from "../src/json.js";
import type { JsonObject } from "@extynt/decode";
import { representativeSnapshot } from "@extynt/project-graph";
import type { ProjectSnapshot, PropertySnapshot } from "@extynt/project-graph";

const POSITION = "ADBE Transform Group/ADBE Position";
const TARGET = { compositionId: "comp-main", layerId: "layer-title", propertyPath: POSITION };

function keyedAt(...times: number[]): ProjectSnapshot {
  const snapshot: ProjectSnapshot = structuredClone(representativeSnapshot);
  const layer = snapshot.compositions.find((composition) => composition.id === "comp-main")?.layers.find((candidate) => candidate.id === "layer-title");
  assert.ok(layer);
  const position: PropertySnapshot = { path: POSITION, matchName: "ADBE Position", displayName: "Position", kind: "property", valueType: "vector", value: [0, 0], canSetValue: true, keyframeCount: times.length, keyframes: times.map((time) => ({ time, value: [0, 0] })) };
  layer.properties = [{ path: "ADBE Transform Group", matchName: "ADBE Transform Group", displayName: "Transform", kind: "group", valueType: "unknown", value: null, canSetValue: false, children: [position] }];
  return snapshot;
}

const animate = (times: number[], extra: JsonObject = {}) => ({ type: "animate_property", target: TARGET, keyframes: times.map((time) => ({ time, value: [1, 1] })), ...extra });

test("set_expression drops a role beside its property path and fills a path from a role alone", () => {
  const both = correctOperation({ type: "set_expression", target: TARGET, role: "transform.position", source: "[0,0]", enabled: true }, representativeSnapshot, 0);
  assert.equal(asObject(both.operation)?.role, undefined);
  assert.equal(both.changes[0]?.field, "role");
  const alone = correctOperation({ type: "set_expression", target: { compositionId: "comp-main", layerId: "layer-title" }, role: "transform.position", source: "[0,0]", enabled: true }, representativeSnapshot, 0);
  assert.equal(stringAt(objectAt(asObject(alone.operation), "target"), "propertyPath"), POSITION);
  assert.equal(alone.changes[0]?.field, "target.propertyPath");
  const unknownRole = { type: "set_expression", target: { compositionId: "comp-main", layerId: "layer-title" }, role: "nonsense", source: "1", enabled: true };
  assert.deepEqual(correctOperation(unknownRole, representativeSnapshot, 0).changes, [], "a role naming no native property is left for the validator");
});

test("keys at the existing key times choose merge; anything else keeps the validator's refusal", () => {
  const snapshot = keyedAt(2, 3);
  const same = correctOperation(animate([2, 3]), snapshot, 0);
  assert.equal(stringAt(asObject(same.operation), "keyframeMode"), "merge");
  assert.equal(same.changes[0]?.field, "keyframeMode");
  assert.equal(correctOperation(animate([2, 3, 4]), snapshot, 0).changes.length, 1, "extra new keys still leave merge and replace identical");
  assert.deepEqual(correctOperation(animate([2]), snapshot, 0).changes, [], "an existing key at a time the new keys miss makes merge and replace differ");
  assert.deepEqual(correctOperation(animate([2, 3], { keyframeMode: "replace" }), snapshot, 0).changes, [], "an explicit mode is the caller's");
  assert.deepEqual(correctOperation(animate([2, 3]), keyedAt(), 0).changes, [], "no existing keys, nothing to decide");
});

test("keys on a layer this job created are rewritten with replace; the same keys on a user's layer keep the refusal", () => {
  const snapshot = keyedAt(2, 3);
  const mine = correctOperation(animate([2]), snapshot, 0, { ownedLayerIds: new Set(["layer-title"]) });
  assert.equal(stringAt(asObject(mine.operation), "keyframeMode"), "replace");
  assert.equal(mine.changes[0]?.field, "keyframeMode");
  assert.deepEqual(correctOperation(animate([2]), snapshot, 0, { ownedLayerIds: new Set(["other-layer"]) }).changes, []);
  assert.deepEqual(correctOperation(animate([2]), snapshot, 0).changes, []);
  assert.deepEqual(correctOperation(animate([2], { keyframeMode: "merge" }), snapshot, 0, { ownedLayerIds: new Set(["layer-title"]) }).changes, [], "an explicit mode is still the caller's");
  assert.deepEqual(correctOperation(animate([2]), keyedAt(), 0, { ownedLayerIds: new Set(["layer-title"]) }).changes, [], "no existing keys, nothing to replace");
});

test("remove_layer needs no destructive for a layer this work created, but a user's layer still does", () => {
  const remove = (layerId: string) => ({ type: "remove_layer", target: { compositionId: "comp-main", layerId } });
  const owned = new Set(["made-by-job"]);
  const fixed = correctOperation(remove("made-by-job"), representativeSnapshot, 0, { ownedLayerIds: owned });
  assert.equal(booleanAt(asObject(fixed.operation), "destructive"), true);
  assert.equal(fixed.changes[0]?.field, "destructive");
  assert.deepEqual(correctOperation(remove("layer-title"), representativeSnapshot, 0, { ownedLayerIds: owned }).changes, [], "a user-made layer still requires destructive");
  assert.deepEqual(correctOperation(remove("made-by-job"), representativeSnapshot, 0).changes, [], "without a known creator nothing is owned");
  const sameCall = correctOperations([{ type: "create_layer", target: { compositionId: "comp-main", layerId: "__new__:tmp" }, layerKind: "solid", name: "T" }, remove("__new__:tmp")], representativeSnapshot);
  assert.equal(sameCall.changes[1]?.[0]?.field, "destructive", "a layer created earlier in the same call is owned");
});

/**
 * draw_vector_shapes on the host: a whole design layer in one step, drawn front-most first because After Effects draws
 * the first group in Contents in front, then read back group by group for the panel to compare.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { type FakeProperty, FakeShape, loadApplyPlan } from "./host-apply-harness.js";
import { childAt, childNamed, itemAt, shapeRoot } from "./host-fake-lookup.js";
import { applyPlan } from "./host-plan-io.js";
import { fieldOf, numberAt, optionalTextAt, plain, recordAt, recordsAt, textAt } from "./json-narrow.js";
import { shapeReadbackMatches } from "./host-shape-readback.js";
import { type JsonObject, type JsonValue } from "@extynt/decode";

const square: JsonObject = { vertices: [[0, 0], [100, 0], [100, 100], [0, 100]], closed: true };
const hole: JsonObject = { vertices: [[25, 25], [75, 25], [75, 75], [25, 75]], closed: true };
const orbit: JsonObject = { vertices: [[0, 120], [100, 150]], inTangents: [[0, 0], [-30, 10]], outTangents: [[30, -10], [0, 0]], closed: false };
const operation: JsonObject = {
  operation: "draw_vector_shapes",
  compositionId: "comp-main",
  layerId: "layer-shape",
  shapes: [
    { name: "Window", paths: [square, hole], fill: { color: [0.2, 0.4, 0.8], opacity: 80, rule: 2 } },
    { name: "Trail", paths: [orbit], stroke: { color: [1, 0.6, 0.1], width: 8, cap: 2, join: 3 }, opacity: 50 },
  ],
};

function drawn() {
  const harness = loadApplyPlan();
  const root = shapeRoot(harness.shapeLayer);
  root.freshWrappers = true;
  const existing = root.children.length;
  const result = applyPlan(harness.apply, "vectors", [operation]);
  return { result, root, existing };
}

function propertyValues(parent: FakeProperty, matchNames: ReadonlyArray<string>): JsonValue[] {
  return matchNames.map((matchName) => plain(childNamed(parent, matchName).value));
}

function assertWindowGroup(group: FakeProperty): void {
  const contents = childNamed(group, "ADBE Vectors Group");
  const members = contents.children.map((member) => member.matchName);
  assert.deepEqual(members, ["ADBE Vector Shape - Group", "ADBE Vector Shape - Group", "ADBE Vector Graphic - Fill"], "both subpaths come before the fill that paints them");
  const fill = childNamed(contents, "ADBE Vector Graphic - Fill");
  assert.deepEqual(propertyValues(fill, ["ADBE Vector Fill Rule", "ADBE Vector Fill Opacity"]), [2, 80]);
  const holeShape = childNamed(childAt(contents, 1), "ADBE Vector Shape").value;
  assert.ok(holeShape instanceof FakeShape);
  assert.deepEqual(plain(holeShape.vertices), [[25, 25], [75, 25], [75, 75], [25, 75]]);
}

function assertTrailGroup(group: FakeProperty): void {
  assert.equal(childNamed(childNamed(group, "ADBE Vector Transform Group"), "ADBE Vector Group Opacity").value, 50);
  const stroke = childNamed(childNamed(group, "ADBE Vectors Group"), "ADBE Vector Graphic - Stroke");
  assert.deepEqual(propertyValues(stroke, ["ADBE Vector Stroke Width", "ADBE Vector Stroke Line Cap", "ADBE Vector Stroke Line Join"]), [8, 2, 3]);
}

test("each shape becomes a named group, the request's last shape in front", () => {
  const { result, root, existing } = drawn();
  assert.equal(fieldOf(result, "ok"), true, optionalTextAt(result, "error", "message"));
  assert.deepEqual(root.children.slice(existing).map((group) => group.name), ["Trail", "Window"]);
  assertWindowGroup(itemAt(root.children, existing + 1));
  assertTrailGroup(itemAt(root.children, existing));
});

test("the readback lists every group in request order, and the panel confirms it against the request", () => {
  const { result, existing } = drawn();
  const step = itemAt(recordsAt(result, "steps"), 0);
  assert.equal(fieldOf(step, "verification"), "vector-shapes-read-back");
  const readback = recordAt(step, "readback");
  const keys = ["name", "ordinal", "paths", "points", "closedPaths"];
  const groups = recordsAt(readback, "groups").map((group) => keys.map((key) => fieldOf(group, key)));
  assert.deepEqual(groups, [["Window", existing + 2, 2, 8, 2], ["Trail", existing + 1, 1, 2, 0]]);
  assert.equal(shapeReadbackMatches("draw_vector_shapes", operation, readback), true);
});

test("the panel refuses a readback whose geometry, paint or order does not match the request", () => {
  const { result } = drawn();
  const readback = recordAt(itemAt(recordsAt(result, "steps"), 0), "readback");
  const groups = recordsAt(readback, "groups");
  const altered = (index: number, change: JsonObject): JsonObject => ({ ...readback, groups: groups.map((group, at) => (at === index ? { ...group, ...change } : group)) });
  const matches = (candidate: JsonObject) => shapeReadbackMatches("draw_vector_shapes", operation, candidate);
  assert.equal(matches(altered(0, { checksum: numberAt(readback, "groups", 0, "checksum") + 5 })), false, "moved points");
  assert.equal(matches(altered(0, { fill: { ...recordAt(readback, "groups", 0, "fill"), rule: 1 } })), false, "lost the even-odd rule");
  assert.equal(matches(altered(1, { stroke: null })), false, "no stroke");
  assert.equal(matches({ ...readback, groups: [recordAt(readback, "groups", 1), recordAt(readback, "groups", 0)] }), false, "swapped order");
  assert.equal(matches({ ...readback, groups: groups.slice(0, 1) }), false, "a missing group");
});

test("a malformed request is refused before anything is drawn", () => {
  const harness = loadApplyPlan();
  const bad: JsonObject = { ...operation, shapes: [{ name: "Invisible", paths: [square] }] };
  const result = applyPlan(harness.apply, "vectors-bad", [bad]);
  assert.equal(fieldOf(result, "ok"), false);
  assert.match(textAt(result, "error", "message"), /draw_vector_shapes requires/);
  assert.equal(harness.calls.begin.length, 0);
});

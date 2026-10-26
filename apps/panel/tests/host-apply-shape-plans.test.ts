/** apply_plan host contract for shapes: typed Shape DTOs, group read-back by property index, root-level paint and refused malformed input. */

import assert from "node:assert/strict";
import test from "node:test";
import { type JsonObject } from "@extynt/decode";
import { FakeShape, loadApplyPlan, loadExtended } from "./host-apply-harness.js";
import { childAt, layerProperty, shapeRoot } from "./host-fake-lookup.js";
import { applyPlan, onLayer } from "./host-plan-io.js";
import { fieldOf, optionalTextAt, plain, recordAt, recordsAt } from "./json-narrow.js";

const TRIANGLE = [[0, 0], [100, 0], [100, 100]];
const NO_TANGENTS = [[0, 0], [0, 0], [0, 0]];

function groupReadback(name: string): JsonObject {
  return {
    matchName: "ADBE Vector Group",
    name,
    ordinal: 2,
    contents: { count: 0, children: [] },
    transform: { anchor: null, position: null, scale: null, rotation: null, opacity: 100 },
  };
}

function createGroup(groupId: string, name: string): JsonObject {
  return onLayer("create_shape_group", "layer-shape", { newGroupId: groupId, name });
}

function setPath(groupId: string, path: JsonObject): JsonObject {
  return onLayer("set_shape_path", "layer-shape", { groupId, path });
}

test("apply_plan converts a typed Shape DTO to a native Shape before writing its path", () => {
  const { apply, shapeLayer } = loadApplyPlan();
  const result = applyPlan(apply, "shape-lifecycle", [
      createGroup("__new__:shape0", "Badge"),
      setPath("__new__:shape0", { vertices: TRIANGLE, inTangents: NO_TANGENTS, outTangents: NO_TANGENTS, closed: true }),
      onLayer("ensure_shape_fill", "layer-shape", { groupId: "__new__:shape0", color: [1, 0, 0], opacity: 80 }),
      onLayer("ensure_shape_stroke", "layer-shape", { groupId: "__new__:shape0", color: [0, 0, 0], width: 4, opacity: 60 }),
    ]);
  assert.equal(fieldOf(result, "ok"), true);
  const steps = recordsAt(result, "steps");
  assert.deepEqual(steps.map((step) => fieldOf(step, "operation")), ["create_shape_group", "set_shape_path", "ensure_shape_fill", "ensure_shape_stroke"]);
  assert.deepEqual(recordAt(steps, 0, "readback"), groupReadback("Badge"), "the host independently re-reads the created group from the layer root, with its (empty) contents and its transform (the fake has only the opacity leaf)");
  assert.deepEqual(recordAt(steps, 1, "readback"), { matchName: "ADBE Vector Shape", vertices: TRIANGLE, inTangents: NO_TANGENTS, outTangents: NO_TANGENTS, closed: true, bounds: null }, "the fake layer has no sourceRectAtTime, so the bounds evidence is null");
  assert.deepEqual(recordAt(steps, 2, "readback"), { matchName: "ADBE Vector Graphic - Fill", color: [1, 0, 0], opacity: 80 });
  assert.deepEqual(recordAt(steps, 3, "readback"), { matchName: "ADBE Vector Graphic - Stroke", color: [0, 0, 0], width: 4, opacity: 60 });
  assert.deepEqual(steps.map((step) => fieldOf(step, "verification")), ["shape-group-read-back", "shape-path-read-back", "shape-fill-read-back", "shape-stroke-read-back"]);
  const writtenPath = childAt(shapeRoot(shapeLayer), 1, 0, 0, 0).value;
  assert.ok(writtenPath instanceof FakeShape);
  assert.deepEqual(plain(writtenPath.vertices), TRIANGLE);
  assert.equal(writtenPath.closed, true);
});

test("apply_plan reads a created shape group back through the property index, not wrapper identity", () => {
  const { apply, shapeLayer } = loadApplyPlan();
  shapeRoot(shapeLayer).freshWrappers = true;
  const result = applyPlan(apply, "fresh-wrappers", [createGroup("__new__:ring", "Ring Band"), setPath("__new__:ring", { vertices: TRIANGLE, closed: true })]);
  assert.equal(fieldOf(result, "ok"), true, optionalTextAt(result, "error", "message"));
  assert.deepEqual(recordAt(result, "steps", 0, "readback"), groupReadback("Ring Band"));
});

test("apply_plan falls back to the ordinal it recorded when AE reports no property index", () => {
  const { apply, shapeLayer } = loadApplyPlan();
  const root = shapeRoot(shapeLayer);
  root.freshWrappers = true;
  const add = root.addProperty.bind(root);
  root.addProperty = (matchName) => {
    const group = add(matchName);
    if (group) Reflect.deleteProperty(group, "propertyIndex");
    return group;
  };
  const result = applyPlan(apply, "recorded-ordinal", [createGroup("__new__:ring", "Ring Band")]);
  assert.equal(fieldOf(result, "ok"), true, optionalTextAt(result, "error", "message"));
  assert.deepEqual(recordAt(result, "steps", 0, "readback"), groupReadback("Ring Band"));
});

test("apply_plan accepts root-level shape fills and strokes used by primitive items", () => {
  const { apply, shapesLayer } = loadExtended();
  const result = applyPlan(apply, "shape-root-paint", [
      onLayer("ensure_shape_fill", "layer-shapes", { groupId: "root", color: [0.2, 0.4, 0.8], opacity: 75 }),
      onLayer("ensure_shape_stroke", "layer-shapes", { groupId: "root", color: [1, 0.6, 0.2], width: 18, opacity: 90 }),
    ]);
  assert.equal(fieldOf(result, "ok"), true, optionalTextAt(result, "error", "message"));
  const steps = recordsAt(result, "steps");
  assert.deepEqual(steps.map((step) => fieldOf(step, "operation")), ["ensure_shape_fill", "ensure_shape_stroke"]);
  assert.deepEqual(recordAt(steps, 0, "readback"), { matchName: "ADBE Vector Graphic - Fill", color: [0.2, 0.4, 0.8], opacity: 75 });
  assert.deepEqual(recordAt(steps, 1, "readback"), { matchName: "ADBE Vector Graphic - Stroke", color: [1, 0.6, 0.2], width: 18, opacity: 90 });
  const root = layerProperty(shapesLayer, "ADBE Root Vectors Group");
  assert.ok(root.children.some((property) => property.matchName === "ADBE Vector Graphic - Fill"));
  assert.ok(root.children.some((property) => property.matchName === "ADBE Vector Graphic - Stroke"));
});

test("apply_plan rejects malformed Shape DTOs before starting AE mutations", () => {
  const { apply, calls } = loadApplyPlan();
  const result = applyPlan(apply, "bad-shape", [setPath("shape:1", { vertices: [[0, 0]], inTangents: [[0, 0], [1, 1]], closed: false })]);
  assert.equal(fieldOf(result, "ok"), false);
  assert.equal(fieldOf(result, "error", "code"), "INVALID_VALUE");
  assert.equal(calls.begin.length, 0);
});

test("apply_plan rejects a forward shape group and unbounded stroke width", () => {
  const { apply } = loadApplyPlan();
  const forward = applyPlan(apply, "shape-forward", [onLayer("ensure_shape_fill", "layer-shape", { groupId: "__new__:later", color: [1, 1, 1] })]);
  assert.equal(fieldOf(forward, "ok"), false);
  assert.equal(fieldOf(forward, "error", "code"), "TARGET_NOT_FOUND");
  const width = applyPlan(apply, "shape-width", [onLayer("ensure_shape_stroke", "layer-shape", { groupId: "shape:1", color: [1, 1, 1], width: 0 })]);
  assert.equal(fieldOf(width, "ok"), false);
  assert.equal(fieldOf(width, "error", "code"), "INVALID_VALUE");
  assert.match(optionalTextAt(width, "error", "message") ?? "", /width must be a finite number greater than 0/);
});

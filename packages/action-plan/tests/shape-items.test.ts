// Shape group and shape item addressing: the root group, typed items, and where groupId may be sent.
import assert from "node:assert/strict";
import test from "node:test";
import type { JsonObject } from "@extynt/decode";
import { fingerprints, target } from "./fixtures.js";
import { assertOperations, assertSequences, refusal } from "./plan-builders.js";

const shapeTarget = { compositionId: "comp-main", layerId: "__new__:shape-layer", ...fingerprints } satisfies JsonObject;
const shapeLayer = { type: "create_layer", target: shapeTarget, layerType: "shape", name: "Ring" } satisfies JsonObject;

function onRoot(operation: JsonObject): readonly JsonObject[] {
  return [shapeLayer, { target: shapeTarget, groupId: "root", ...operation }];
}

test("a shape stroke, fill and path on root are accepted", () => {
  assertSequences([
    ["ok", onRoot({ type: "ensure_shape_stroke", color: [1, 1, 1], width: 8 })],
    ["ok", onRoot({ type: "ensure_shape_fill", color: [0.2, 0.4, 0.9] })],
    ["ok", onRoot({ type: "set_shape_path", path: { vertices: [[0, 0], [100, 0], [100, 100]], closed: true } })],
  ], { bounds: { maxOperations: 2 } });
});

test("a group that is neither root, an ordinal nor a placeholder is refused and root is named", () => {
  const bad = refusal(onRoot({ type: "ensure_shape_fill", groupId: "not-a-group", color: [1, 0, 0] }), { bounds: { maxOperations: 2 } });
  assert.equal(bad.code, "TARGET_NOT_FOUND");
  assert.match(bad.message, /root/);
});

test("add_shape_item takes a repeater on root and update_shape_item an itemId", () => {
  const rectangle = { type: "add_shape_item", target: shapeTarget, groupId: "root", item: "rectangle", newItemId: "__new__:rect0", values: { size: [100, 200] } } satisfies JsonObject;
  const update = { type: "update_shape_item", target: shapeTarget, groupId: "root", item: "rectangle", itemId: "__new__:rect0", values: { position: [50, 75] } } satisfies JsonObject;
  assertSequences([
    ["ok", onRoot({ type: "add_shape_item", item: "repeater", newItemId: "__new__:repeat0", values: { copies: 5 } })],
    ["ok", [shapeLayer, rectangle, update]],
  ], { bounds: { maxOperations: 3 } });
});

test("add_shape_item refuses an unknown item, keyframes it cannot take and a non-shape layer", () => {
  assertSequences([
    ["INVALID_VALUE", onRoot({ type: "add_shape_item", item: "unknown", newItemId: "__new__:bad" })],
    ["INVALID_VALUE", onRoot({ type: "add_shape_item", item: "repeater", newItemId: "__new__:bad", keyframes: { composite: [{ time: 0, value: 1 }] } })],
  ], { bounds: { maxOperations: 2 } });
  assertOperations([["INVALID_TARGET", { type: "add_shape_item", target, groupId: "root", item: "repeater", newItemId: "__new__:onText" }]]);
});

test("a groupId sent inside target is named as misplaced", () => {
  const inside = refusal([shapeLayer, { type: "add_shape_item", target: { ...shapeTarget, groupId: "root" }, item: "repeater", newItemId: "__new__:repeat1" }], { bounds: { maxOperations: 2 } });
  assert.match(inside.message, /groupId is not a target field\. If add_shape_item takes groupId, send it at the top level beside target/);
});

/** Receipt verdicts for derive_layer split: the host step names the NEW layer, so the source is found through the operation's own target. */
import type { JsonObject } from "@extynt/decode";
import assert from "node:assert/strict";
import test from "node:test";
import { verifyDeriveLayer } from "../src/verify/verify-derive.js";
import type { SnapshotComposition } from "../src/verify/snapshot-reply.js";
import { layerStateOf } from "./verify-fixtures.js";

const operation: JsonObject = { operation: "derive_layer", compositionId: "1", layerId: "18", kind: "split", newLayerId: "__new__:layer0", time: 3 };
const created: JsonObject = { operation: "derive_layer", compositionId: "1", layerId: "23", sourceLayerId: "18" };

function verdict(layers: NonNullable<SnapshotComposition["layers"]>) {
  const comp = { id: "1", width: 640, height: 360, duration: 8, frameRate: 25, layers };
  return verifyDeriveLayer(layerStateOf({ operation, step: created, compositions: [comp] }));
}

test("a split verifies when the source ends at the time and the copy starts there, the copy running on to the original end", () => {
  const result = verdict([{ id: "23", type: "text", inPoint: 3, outPoint: 8, startTime: 0 }, { id: "18", type: "text", inPoint: 0, outPoint: 3, startTime: 0 }]);
  assert.equal(result.verificationState, "exact");
  assert.equal(result.basis, "layer-split");
});

test("a split whose copy slid along the timeline (same length, moved clock) fails", () => {
  const result = verdict([{ id: "23", type: "text", inPoint: 3, outPoint: 11, startTime: 3 }, { id: "18", type: "text", inPoint: 0, outPoint: 3, startTime: 0 }]);
  assert.equal(result.basis, "split-points-mismatch");
});

test("a split whose source did not end at the time fails", () => {
  const result = verdict([{ id: "23", type: "text", inPoint: 3, outPoint: 8 }, { id: "18", type: "text", inPoint: 0, outPoint: 8 }]);
  assert.equal(result.basis, "split-points-mismatch");
});

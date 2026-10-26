// Tests that removals of things the job itself created are owned and not counted as deletes, while removals of a user's layers, items and compositions still warn.
import test from "node:test";
import assert from "node:assert/strict";
import { ownedRemovalIndexes } from "../src/own-work.js";
import { undoNotices } from "../src/notices.js";
import { operationsOf } from "../src/operations.js";
import type { JsonObject } from "@extynt/decode";

const rows = operationsOf;
const remove = (layerId: string, type = "remove_layer"): JsonObject => ({ type, destructive: true, target: { compositionId: "c1", layerId } });

test("a removal of a layer an earlier batch of the job created is not counted as a delete", () => {
  const operations = rows([remove("L9"), remove("L1")]);
  assert.deepEqual([...ownedRemovalIndexes(operations, new Set(["L9"]))], [0]);
  const notice = undoNotices(operations, new Set(["L9"])).find((entry) => entry.code === "DESTRUCTIVE");
  assert.equal(notice?.title, "This plan deletes something.");
  assert.deepEqual(notice?.operationIndexes, [1]);
  assert.equal(undoNotices(rows([remove("L9")]), new Set(["L9"])).some((entry) => entry.code === "DESTRUCTIVE"), false);
});

test("a layer created earlier in the same plan is owned, one created later or unknown is not", () => {
  const created: JsonObject = { type: "create_layer", target: { compositionId: "c1", layerId: "__new__:bg" }, layerType: "solid" };
  assert.deepEqual([...ownedRemovalIndexes(rows([created, remove("__new__:bg")]))], [1]);
  assert.deepEqual([...ownedRemovalIndexes(rows([remove("__new__:bg"), created]))], []);
  assert.deepEqual([...ownedRemovalIndexes(rows([{ type: "duplicate_layer", target: { layerId: "L1" }, newLayerId: "__new__:dup" }, remove("__new__:dup")]))], [1]);
  assert.deepEqual([...ownedRemovalIndexes(rows([remove("L1")]), new Set(["L2"]))], []);
});

test("masks and markers on a job-created layer are owned; a composition marker on a user's composition is not", () => {
  const operations = rows([remove("L9", "remove_mask"), remove("L9", "remove_marker"), { type: "remove_marker", destructive: true, target: { compositionId: "L9" } }, { type: "remove_marker", destructive: true, target: { compositionId: "c1" } }]);
  assert.deepEqual([...ownedRemovalIndexes(operations, new Set(["L9"]))], [0, 1, 2]);
});

const under = (type: string, target: JsonObject): JsonObject => ({ type, destructive: true, target });
const del = (itemId: string): JsonObject => ({ type: "delete_project_item", destructive: true, target: { itemId } });

test("a project item the job created is owned by id; a pre-existing one and cleanup_project are not", () => {
  const operations = rows([del("C9"), del("C1"), { type: "cleanup_project", destructive: true }, { type: "remove_unused_footage", destructive: true }]);
  assert.deepEqual([...ownedRemovalIndexes(operations, new Set(["C9"]))], [0]);
  const planned = rows([{ type: "create_composition", newCompositionId: "__new__:comp", name: "x" }, { type: "create_folder", newFolderId: "__new__:f" }, del("__new__:comp"), del("__new__:f"), del("C1")]);
  assert.deepEqual([...ownedRemovalIndexes(planned)], [2, 3]);
});

test("removals under a job-created composition or layer are owned, the same on the user's are not", () => {
  const operations = rows([
    under("remove_effect", { compositionId: "c1", layerId: "L9", effectPath: "e" }),
    under("remove_effect", { compositionId: "c1", layerId: "L1", effectPath: "e" }),
    under("delete_keyframes", { compositionId: "c1", layerId: "L9", propertyPath: "p" }),
    under("delete_keyframes", { compositionId: "c1", layerId: "L1", propertyPath: "p" }),
    under("remove_layer", { compositionId: "C9", layerId: "L1" }),
  ]);
  assert.deepEqual([...ownedRemovalIndexes(operations, new Set(["L9", "C9"]))], [0, 2], "a user's layer inside a job-created composition is not owned");
});

test("the removal's own target must be job-created: the layer, the item, or the layer a sub-item sits on", () => {
  const ids = new Set(["C9"]);
  assert.deepEqual([...ownedRemovalIndexes(rows([remove("L1")]), ids)], []);
  assert.deepEqual([...ownedRemovalIndexes(rows([under("remove_mask", { compositionId: "C9", layerId: "L1" }), under("remove_marker", { compositionId: "C9" })]), ids)], [1], "only a composition marker with no layer rides on the composition");
  assert.deepEqual([...ownedRemovalIndexes(rows([del("L9")]), new Set(["L9x"]))], []);
});

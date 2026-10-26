/** Tests that the plan store is read back leniently: a malformed row or member costs only itself. */
import assert from "node:assert/strict";
import test from "node:test";
import { planStoreRows, recalledOperations } from "../src/run-store.js";
import type { WireObject } from "../src/wire-types.js";

function storeAnswering(answer: WireObject) {
  return { callTool: async (): Promise<WireObject> => answer };
}

test("a listed row that is not an object, or has no string plan id, is skipped without emptying the list", async () => {
  const rows = [{ planId: "a", status: "applied" }, "stray", null, { planId: 7, status: "applied" }, { status: "applied" }, { planId: "b", status: "undone" }];
  assert.deepEqual(await planStoreRows(storeAnswering({ data: rows })), [{ planId: "a", status: "applied" }, { planId: "b", status: "undone" }]);
});

test("a listed row whose status is not a string reads as an empty status", async () => {
  assert.deepEqual(await planStoreRows(storeAnswering({ data: [{ planId: "a", status: 3 }, { planId: "b" }] })), [{ planId: "a", status: "" }, { planId: "b", status: "" }]);
});

test("a list answer whose data is not an array lists no plans", async () => {
  assert.deepEqual(await planStoreRows(storeAnswering({ data: "none" })), []);
});

test("a recalled page whose operations are not an array still follows its next cursor", async () => {
  const pages: WireObject[] = [{ data: { operations: "gone", nextCursor: 1 } }, { data: { operations: [{ type: "set_property" }] } }];
  let served = 0;
  const sidecar = { callTool: async (): Promise<WireObject> => pages[served++] ?? {} };
  assert.deepEqual(await recalledOperations(sidecar, ["plan"]), ['[{"type":"set_property"}]']);
  assert.equal(served, 2);
});

test("a recalled page whose cursor is not a number ends the recall after its operations", async () => {
  const sidecar = storeAnswering({ data: { operations: [{ type: "set_property" }], nextCursor: "next" } });
  assert.deepEqual(await recalledOperations(sidecar, ["plan"]), ['[{"type":"set_property"}]']);
});

// Tests the collection service directly: layer pages, their metadata and the inventory the service retains from them.
import assert from "node:assert/strict";
import test from "node:test";
import type { JsonObject } from "@extynt/decode";
import { CollectionService } from "../src/collection-service.js";
import { fieldOf, listOf, maybeTextOf, textOf } from "./http-json.js";

interface Page { rows: JsonObject[]; count: number; nextCursor?: number | null; overrides?: JsonObject }

const stamp = { epoch: 1, revision: 1 };
const metadata = (count: number) => ({ activeCompositionId: "comp", runtime: { application: "After Effects" }, project: { name: "Untitled", filePath: null }, composition: { id: "comp", itemIndex: 1, name: "Composition", width: 1920, height: 1080, duration: 10, frameRate: 30 }, layerCount: count });
const row = (index: number, id = String(index)): JsonObject => ({ id, index, layerIndex: index, name: `Layer ${index}`, locked: false, selected: false, detail: "layer-index", properties: "unknown", values: "not-read" });
const rowWithoutLayerIndex = (): JsonObject => ({ id: "1", index: 1, name: "Layer 1", locked: false, selected: false, detail: "layer-index", properties: "unknown", values: "not-read" });
function begin(service: CollectionService): JsonObject { return service.prepare({ begin: true, target: { kind: "layers", compositionId: "comp", itemIndex: 1 }, maxRows: 25 }, false); }
function finish(service: CollectionService, dispatch: JsonObject, input: Page): JsonObject {
  const { rows, count, nextCursor = null, overrides = {} } = input;
  const ticket = textOf(dispatch, "ticket");
  service.authorizeDispatch({ ticket });
  return service.complete({ ticket, page: { ok: true, requestId: ticket, sessionId: "detail-1", stamp, metadata: metadata(count), kind: "layers", rows, nextCursor, deepComplete: false, ...overrides } });
}
function resume(service: CollectionService, first: JsonObject): JsonObject { return service.prepare({ jobId: textOf(first, "jobId") }, false); }
function key(id: string): string { return JSON.stringify(["layers", "comp", null, null, id]); }
function stateOf(service: CollectionService, id: string): string | undefined { return maybeTextOf(service.lookup(key(id)), "state"); }

test("native layer shape publishes scoped metadata only after a contiguous unique inventory", () => {
  const service = new CollectionService();
  const first = finish(service, begin(service), { rows: [row(1)], count: 2, nextCursor: 2 });
  assert.equal(fieldOf(first, "snapshot"), undefined);
  const final = finish(service, resume(service, first), { rows: [row(2)], count: 2 });
  assert.equal(listOf(final, "snapshot.result.compositions.0.layers").length, 2);
  assert.equal(fieldOf(final, "snapshot.result.coverage.properties"), "unknown");
  assert.equal(fieldOf(final, "snapshot.result.coverage.otherCompositions"), "unknown");
  assert.deepEqual(service.lookup(key("unobserved")), { state: "unknown", writeAuthorizing: false });
  assert.equal(fieldOf(service.lookup(key("1")), "writeAuthorizing"), false);
});

const malformedPages: Array<[string, JsonObject[], number, number | null, JsonObject]> = [
  ["duplicate IDs", [row(1, "same"), row(2, "same")], 2, null, {}],
  ["duplicate indexes", [row(1), row(1, "second")], 2, null, {}],
  ["missing index", [row(1), row(3)], 2, null, {}],
  ["missing layerIndex", [rowWithoutLayerIndex()], 1, null, {}],
  ["short terminal page", [row(1)], 2, null, {}],
  ["oversized inventory", [row(1), row(2)], 1, null, {}],
  ["skipped continuation", [row(1)], 3, 3, {}],
  ["empty nonterminal page", [], 1, 2, {}],
  ["wrong composition identity", [row(1)], 1, null, { metadata: { ...metadata(1), composition: { ...metadata(1).composition, id: "other" } } }],
  ["wrong composition ordinal", [row(1)], 1, null, { metadata: { ...metadata(1), composition: { ...metadata(1).composition, itemIndex: 2 } } }],
];
for (const [name, rows, count, next, overrides] of malformedPages) test(`rejects ${name} before publishing rows`, () => {
  const service = new CollectionService();
  assert.throws(() => finish(service, begin(service), { rows, count, nextCursor: next, overrides }));
  for (const value of rows) assert.equal(stateOf(service, textOf(value, "id")), "unknown");
});

test("duplicate IDs across pages invalidate the partial inventory", () => {
  const service = new CollectionService();
  const first = finish(service, begin(service), { rows: [row(1, "same")], count: 2, nextCursor: 2 });
  assert.throws(() => finish(service, resume(service, first), { rows: [row(2, "same")], count: 2 }), /INVALID_LAYER_INVENTORY/);
  assert.equal(stateOf(service, "same"), "unknown");
});

for (const count of [2, 1025]) test(`metadata stays consistent across pages for ${count} layers`, () => {
  const service = new CollectionService();
  const first = finish(service, begin(service), { rows: [row(1)], count, nextCursor: 2 });
  const changed = { metadata: { ...metadata(count), project: { name: "Changed", filePath: null } } };
  assert.throws(() => finish(service, resume(service, first), { rows: [row(2)], count, nextCursor: count === 2 ? null : 3, overrides: changed }), /PROJECT_CHANGED/);
  assert.equal(stateOf(service, "1"), "unknown");
  assert.equal(stateOf(service, "2"), "unknown");
});

test("revision unavailable remains observational without a metadata snapshot", () => {
  const service = new CollectionService();
  const result = finish(service, begin(service), { rows: [row(1)], count: 1, overrides: { stamp: { epoch: 1, revision: null }, metadata: null } });
  assert.equal(fieldOf(result, "snapshot"), undefined);
  assert.equal(stateOf(service, "1"), "stale");
});

test("empty composition is a valid complete inventory", () => {
  const service = new CollectionService();
  const result = finish(service, begin(service), { rows: [], count: 0 });
  assert.deepEqual(listOf(result, "snapshot.result.compositions.0.layers"), []);
});

test("changed layer count across pages invalidates retained evidence", () => {
  const service = new CollectionService();
  const first = finish(service, begin(service), { rows: [row(1)], count: 2, nextCursor: 2 });
  assert.throws(() => finish(service, resume(service, first), { rows: [row(2)], count: 3, nextCursor: 3 }), /PROJECT_CHANGED/);
  assert.equal(stateOf(service, "1"), "unknown");
});

test("a malformed later row publishes none of its page", () => {
  const service = new CollectionService();
  assert.throws(() => finish(service, begin(service), { rows: [row(1), { ...row(2), locked: "false" }], count: 2 }), /INVALID_LAYER_INVENTORY/);
  assert.equal(stateOf(service, "1"), "unknown");
  assert.equal(stateOf(service, "2"), "unknown");
});

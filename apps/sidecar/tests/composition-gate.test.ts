/** Before a turn or a plan-making tool the agent's compositions are made current: read now, scoped, and waited for. */
import { compositionIdsMentioned } from "../src/composition-gate.js";
import { recordOf, textOf, type JsonObject } from "./http-json.js";
import { present } from "./present.js";
import { landed, read, start } from "./read-fixture.js";
import assert from "node:assert/strict";
import test from "node:test";

type Harness = Awaited<ReturnType<typeof landed>>;
const settled = <T,>(promise: Promise<T>) => { const box: { done: boolean; value?: T } = { done: false }; void promise.then((value) => { box.done = true; box.value = value; }); return box; };
const until = async (predicate: () => boolean, what: string) => { for (let attempt = 0; attempt < 300 && !predicate(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5)); assert.ok(predicate(), what); };
async function answer(h: Harness, revision: number, compositions: string[]) {
  const claimed = await h.claim({ revision, items: 2 }), id = textOf(claimed.body, "item.readId");
  assert.equal((await h.post("/v1/snapshots", read(id, revision, { scoped: { items: "skipped" }, compositions }))).status, 201);
  return claimed.body;
}
const renameOn = (compositionId: string) => ({ operations: [{ type: "set_layer_name", target: { compositionId, layerId: "layer-1" }, name: "x" }] });

test("a turn begun right after an edit reads the open composition first, and goes ahead once it has landed", async (t) => {
  const h = await landed(t);
  h.stamp(11);
  const turn = settled(h.sidecar.beforeTurn({}));
  await until(() => h.refreshes().length === 1, "the turn asked for a read at once");
  assert.deepEqual(recordOf(present(h.refreshes()[0]), "read"), { scope: "compositions", compositionIds: ["comp-1"], includeItems: false });
  assert.equal(textOf(present(h.refreshes()[0]), "reason"), "gate"); assert.equal(turn.done, false, "the turn waits for the read");
  await answer(h, 11, ["comp-1"]);
  await until(() => turn.done, "the turn went ahead");
  assert.equal(turn.value, undefined, "with nothing to report");
});

test("a turn whose composition is already current waits for nothing", async (t) => {
  const h = await landed(t);
  await h.claim({ revision: 10, items: 2 });
  assert.equal(await h.sidecar.beforeTurn({}), undefined); assert.equal(h.refreshes().length, 0);
});

test("a read that never lands lets the turn go ahead with a note naming the composition", async (t) => {
  const h = await landed(t);
  h.stamp(11);
  const note = await h.sidecar.beforeTurn({});
  assert.match(String(note), /comp-1/); assert.match(String(note), /ae_refresh_snapshot/);
});

test("a plan-making tool that names an out-of-date composition asks for exactly that one, and waits", async (t) => {
  const h = await landed(t);
  h.stamp(11);
  assert.equal((await h.post("/v1/snapshots", read("comp2-11", 11, { scoped: { items: "skipped" }, compositions: ["comp-2"] }))).status, 201, "comp-2 is already current");
  await h.focus({ revision: 11, activeCompositionId: "comp-2", activeCompositionName: "Other", selected: [], selectedLayers: [] });
  const gate = settled(h.sidecar.beforeTool("ae_propose_plan", true, renameOn("comp-1")));
  await until(() => h.refreshes().length === 1, "the tool asked for a read at once");
  assert.deepEqual(recordOf(present(h.refreshes()[0]), "read"), { scope: "compositions", compositionIds: ["comp-1"], includeItems: false }, "only the composition its arguments name");
  assert.equal(gate.done, false);
  await answer(h, 11, ["comp-1"]);
  await until(() => gate.done, "the tool went ahead");
  assert.equal(gate.value, undefined);
});

test("a layer read of a composition edited while another is open reads that composition first, and waits for it", async (t) => {
  const h = await landed(t);
  h.stamp(11);
  assert.equal((await h.post("/v1/snapshots", read("comp2-11", 11, { scoped: { items: "skipped" }, compositions: ["comp-2"] }))).status, 201, "the open composition was read at the edit's revision");
  await h.focus({ revision: 11, activeCompositionId: "comp-2", activeCompositionName: "Other", selected: [], selectedLayers: [] });
  const gate = settled(h.sidecar.beforeTool("ae_inspect_layer", true, { compositionId: "comp-1", layerId: "layer-1", include: "full" }));
  await until(() => h.refreshes().length === 1, "the read tool asked for the composition it names");
  assert.deepEqual(recordOf(present(h.refreshes()[0]), "read"), { scope: "compositions", compositionIds: ["comp-1"], includeItems: false });
  assert.equal(gate.done, false);
  await answer(h, 11, ["comp-1"]);
  await until(() => gate.done, "the read tool went ahead");
  assert.equal(gate.value, undefined);
  assert.equal(await h.sidecar.beforeTool("ae_inspect_layer", true, { compositionId: "comp-1", layerId: "layer-1" }), undefined, "now current: nothing more is asked");
  assert.equal(h.refreshes().length, 0, "the answered read is the only one that was queued");
});

test("a read tool that names no composition reads the open one, and a note says so when the read does not land", async (t) => {
  const h = await landed(t);
  h.stamp(11);
  assert.match(String(await h.sidecar.beforeTool("ae_inspect_composition", true, {})), /comp-1.*ae_refresh_snapshot/);
  assert.deepEqual(recordOf(present(h.refreshes()[0]), "read"), { scope: "compositions", compositionIds: ["comp-1"], includeItems: false });
});

test("what a tool is told when the read does not land, and when it is not an agent's call or not a plan tool", async (t) => {
  const h = await landed(t);
  h.stamp(11);
  assert.match(String(await h.sidecar.beforeTool("ae_propose_plan", true, renameOn("comp-1"))), /could not be re-read/);
  h.sidecar.agentMailbox.splice(0);
  assert.equal(await h.sidecar.beforeTool("ae_propose_plan", false, renameOn("comp-1")), undefined, "the panel's own calls are never gated");
  assert.equal(h.refreshes().length, 0);
  assert.equal(await h.sidecar.beforeTool("ae_get_plan_status", true, renameOn("comp-1")), undefined, "only plan-making tools wait");
  assert.equal(h.refreshes().length, 0);
});

test("a tool with a stale composition in view but no stamp from the panel cannot prove anything and does not wait", async (t) => {
  const h = await landed(t);
  h.clock.ms += 60_000;
  await h.focus({ revision: 10 }); h.sidecar.liveStamp = null;
  assert.equal(await h.sidecar.beforeTool("ae_propose_plan", true, renameOn("comp-1")), undefined); assert.equal(h.refreshes().length, 0);
});

test("the arguments are scanned for composition ids, bounded, and matched against what the snapshot holds", () => {
  const held = new Set(["12", "34"]);
  assert.deepEqual(compositionIdsMentioned({ operations: [{ target: { compositionId: "12" } }, { compositionId: "99" }, { nested: [["34"]] }] }, held).sort(), ["12", "34"]);
  assert.deepEqual(compositionIdsMentioned({ a: 12, b: "x".repeat(500) }, held), [], "numbers and oversize strings are not ids");
  assert.deepEqual(compositionIdsMentioned(undefined, held), []);
  const nested = (level: number): JsonObject => level === 0 ? { id: "12" } : { next: nested(level - 1) };
  const deep = nested(20);
  assert.deepEqual(compositionIdsMentioned(deep, held), [], "past the depth limit nothing is read");
  assert.deepEqual(compositionIdsMentioned({ list: Array.from({ length: 6000 }, () => "99").concat(["12"]) }, held), [], "past the count limit nothing is read");
});

test("a focus report carries the revision and item count AE was at and is taken as the panel's stamp, unless a claim's is newer", async (t) => {
  const h = await landed(t);
  h.clock.ms += 100;
  assert.equal((await h.focus({ revision: 11, items: 2 })).status, 200);
  assert.deepEqual({ ...h.sidecar.liveStamp, at: 0 }, { epoch: 3, revision: 11, items: 2, at: 0 });
  h.clock.ms += 100; await h.claim({ revision: 12, items: 3 });
  assert.equal(h.sidecar.liveStamp?.revision, 12);
  assert.equal((await h.focus({ revision: 11, items: 2, observedAt: h.clock.ms - 150 })).status, 200);
  assert.equal(h.sidecar.liveStamp?.revision, 12, "an older report does not replace a newer stamp");
  assert.equal((await h.focus({ items: -1 })).status, 422, "the item count is a non-negative integer");
});

test("the stamp a report brings is what lets the next turn see an edit the claims have not reported yet", async (t) => {
  const h = await landed(t);
  h.clock.ms += 100;
  await h.focus({ revision: 11, items: 2 });
  const turn = settled(h.sidecar.beforeTurn({}));
  await until(() => h.refreshes().length === 1, "the report alone made the open composition out of date");
  await answer(h, 11, ["comp-1"]);
  await until(() => turn.done, "and the read ended the wait");
});

test("every stale composition is refreshed, in slices, not only the first slice's worth", async (t) => {
  const h = await start(t);
  const ids = Array.from({ length: 300 }, (_, index) => `c${index}`);
  const bulk = (requestId: string, revision: number, wanted: string[], scoped: boolean) => {
    const base = read(requestId, revision, scoped ? { scoped: { items: "skipped" }, compositions: ["comp-1"] } : {});
    const main = present(base.result.compositions[0]);
    const items = scoped ? [] : ids.map((id) => ({ id, name: id, type: "composition", parentFolderId: null, compositionId: id, sourceId: null }));
    return { ...base, result: { ...base.result, compositions: wanted.map((id) => ({ ...main, id })), items, itemCount: ids.length } };
  };
  const first = await h.claim();
  assert.equal((await h.post("/v1/snapshots", bulk(textOf(first.body, "item.readId"), 10, ids, false))).status, 201);
  h.stamp(11, ids.length);
  const gate = settled(h.sidecar.beforeTool("ae_propose_plan", true, { operations: ids.map((compositionId) => ({ target: { compositionId } })) }));
  const answerSlice = async (expected: string[]) => {
    await until(() => h.refreshes().length > 0, "the next slice was asked for");
    assert.deepEqual(recordOf(present(h.refreshes().at(-1)), "read").compositionIds, expected);
    const claimed = await h.claim({ revision: 11, items: 2 });
    assert.equal((await h.post("/v1/snapshots", bulk(textOf(claimed.body, "item.readId"), 11, expected, true))).status, 201);
  };
  await answerSlice(ids.slice(0, 256));
  await answerSlice(ids.slice(256));
  await until(() => gate.done, "the tool went ahead once every composition was read");
  assert.equal(gate.value, undefined, "every composition is current: nothing is reported");
});

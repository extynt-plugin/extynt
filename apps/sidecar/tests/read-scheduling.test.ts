/** The sidecar owns the reads end to end over HTTP: the post-pair read is claimable, edits are read as soon as they are seen, scoped answers are merged, and what cannot be placed is refused. */
import { fieldOf, flagOf, listOf, readJson, recordOf, textOf } from "./http-json.js";
import { sidecarFor, token } from "./sidecar-fixture.js";
import { tickReadScheduler } from "../src/read-scheduler.js";
import { recordUnknownNativeAccess } from "../src/native-mutation-lease.js";
import assert from "node:assert/strict";
import test from "node:test";

import { present } from "./present.js";
import { landed, read, start } from "./read-fixture.js";

test("a freshly paired panel claims the whole-project read before anything is refused, once, with the census while no inventory is known", async (t) => {
  const h = await start(t);
  const first = await h.claim();
  assert.equal(first.status, 200); assert.equal(textOf(first.body, "item.kind"), "refresh_snapshot"); assert.equal(textOf(first.body, "item.reason"), "pair");
  assert.deepEqual(recordOf(first.body, "item.read"), { scope: "full" }); assert.equal(flagOf(first.body, "item.includeEffects"), true);
  assert.match(textOf(first.body, "item.readId"), /^read-/);
  const second = await h.claim();
  assert.equal(second.status, 409); assert.equal(textOf(second.body, "error.code"), "AWAITING_FRESH_SNAPSHOT", "while the read is out, claims are still refused");
  assert.equal((await h.post("/v1/snapshots", read(textOf(first.body, "item.readId"), 10))).status, 201);
  const after = await h.claim();
  assert.equal(after.status, 200); assert.equal(fieldOf(after.body, "item"), null, "and once it lands nothing else is asked");
  assert.equal(h.sidecar.awaitingFreshSnapshotAfterPair, false);
});

test("a read that never landed is asked for again after 30 s, not before", async (t) => {
  const h = await start(t);
  await h.claim(); h.sidecar.settleHostFlight(); h.clock.ms += 29_000;
  assert.equal((await h.claim()).status, 409); assert.equal(h.refreshes().length, 0);
  h.clock.ms += 1_500; const again = await h.claim();
  assert.equal(again.status, 200); assert.equal(textOf(again.body, "item.kind"), "refresh_snapshot");
});

test("an edit is read once, as soon as its revision is seen, as the open composition alone", async (t) => {
  const h = await landed(t);
  assert.equal(fieldOf((await h.claim({ revision: 10, items: 2 })).body, "item"), null, "the stamp the read carried is current");
  h.clock.ms += 1000;
  const item = (await h.claim({ revision: 11, items: 2 })).body;
  assert.equal(textOf(item, "item.kind"), "refresh_snapshot"); assert.equal(textOf(item, "item.reason"), "edit");
  assert.deepEqual(recordOf(item, "item.read"), { scope: "compositions", compositionIds: ["comp-1"], includeItems: false });
  assert.equal(fieldOf(item, "item.includeEffects"), undefined, "the census is not repeated");
  const before = present(h.sidecar.normalizedLatest()).fingerprint;
  const answer = await h.post("/v1/snapshots", read(textOf(item, "item.readId"), 11, { name: "Edited", scoped: { items: "skipped" }, compositions: ["comp-1"] }));
  assert.equal(answer.status, 201); const body = await readJson(answer);
  assert.notEqual(textOf(body, "fingerprint"), before, "the edit moved the project fingerprint");
  assert.equal(textOf(body, "view.activeComposition.id"), "comp-1", "and the answer carries the view the panel draws");
  const stored = present(h.sidecar.latest).snapshot.result;
  assert.deepEqual(listOf(stored, "compositions").map((composition) => textOf(composition, "id")), ["comp-1", "comp-2"], "the composition that was not read is still there");
  assert.deepEqual(fieldOf(stored, "readScope"), { compositions: "all", items: "read" }); assert.equal(fieldOf(stored, "coverage"), undefined);
  assert.equal(fieldOf((await h.claim({ revision: 11, items: 2 })).body, "item"), null, "and the same revision is not read again");
});

test("an identical re-read keeps the fingerprint, and an old answer cannot replace a newer one", async (t) => {
  const h = await landed(t), printed = present(h.sidecar.normalizedLatest()).fingerprint;
  const again = await h.post("/v1/snapshots", read("again-1", 25, { scoped: { items: "skipped" }, compositions: ["comp-1"] }));
  assert.equal(again.status, 201); assert.equal(textOf(await readJson(again), "fingerprint"), printed, "AE's revision counter is not project content");
  const replay = await h.post("/v1/snapshots", read(h.firstReadId, 10));
  assert.equal(replay.status, 409); assert.equal(textOf(await readJson(replay), "error.code"), "SUPERSEDED_SNAPSHOT", "the merged-over read is a superseded observation");
});

test("a composition the sidecar asked for and the host no longer has is dropped from the snapshot", async (t) => {
  const h = await landed(t);
  h.clock.ms += 1000;
  await h.focus({ revision: 11, activeCompositionId: "comp-2", activeCompositionName: "Other", selected: [], selectedLayers: [] });
  const item = (await h.claim({ revision: 11, items: 2 })).body;
  assert.deepEqual(listOf(item, "item.read.compositionIds"), ["comp-2"]);
  assert.equal((await h.post("/v1/snapshots", read(textOf(item, "item.readId"), 11, { scoped: { items: "skipped" }, compositions: [] }))).status, 201);
  const ids = listOf(present(h.sidecar.latest).snapshot.result, "compositions").map((composition) => textOf(composition, "id"));
  assert.deepEqual(ids, ["comp-1"]);
});

test("a scoped read that cannot be placed is refused with READ_NEEDS_FULL, and the full read is queued", async (t) => {
  const h = await landed(t);
  const scoped = (id: string, over: Parameters<typeof read>[2] = {}) => read(id, 12, { scoped: { items: "skipped" }, compositions: ["comp-1"], ...over });
  for (const [label, body] of [["another epoch", scoped("e", { epoch: 4 })], ["no stamp", scoped("s", { stamp: false })]] as const) {
    const refused = await h.post("/v1/snapshots", body);
    assert.equal(refused.status, 409, label); assert.equal(textOf(await readJson(refused), "error.code"), "READ_NEEDS_FULL", label);
    assert.deepEqual(h.refreshes().map((entry) => entry.read), [{ scope: "full" }], `${label}: a full read is waiting`);
    h.sidecar.agentMailbox.splice(0);
  }
  assert.equal(present(h.sidecar.latest).snapshot.requestId, h.firstReadId, "and the stored snapshot is untouched");
  const unpaired = await start(t);
  assert.equal((await unpaired.post("/v1/snapshots", scoped("n"))).status, 409, "no snapshot to merge into");
});

test("selecting layers, opening a composition the snapshot holds and idling cause no read", async (t) => {
  const h = await landed(t);
  for (const over of [{ selected: ["layer-2"], selectedLayers: [] }, { selected: [] , selectedLayers: [] }, { activeCompositionId: "comp-2", activeCompositionName: "Other", selected: [], selectedLayers: [] }]) {
    h.clock.ms += 2000; await h.focus(over);
    assert.equal(fieldOf((await h.claim({ revision: 10, items: 2 })).body, "item"), null);
  }
  assert.equal(h.refreshes().length, 0);
});

test("another project is read whole, and so is a composition the snapshot does not hold", async (t) => {
  const h = await landed(t);
  h.clock.ms += 1000; await h.focus({ activeCompositionId: "comp-9", activeCompositionName: "New", selected: [], selectedLayers: [] });
  const unknown = (await h.claim({ revision: 10, items: 3 })).body;
  assert.deepEqual(recordOf(unknown, "item.read"), { scope: "compositions", compositionIds: ["comp-9"], includeItems: true }, "a new composition comes with the item list: the count moved");
  h.clock.ms += 1000; const switched = (await h.claim({ revision: 1, epoch: 9, items: 5 })).body;
  assert.equal(textOf(switched, "item.reason"), "project"); assert.deepEqual(recordOf(switched, "item.read"), { scope: "full" }, "a stamp from another project epoch asks for everything");
});

test("nothing is scheduled while a native call is unresolved", async (t) => {
  const sidecar = sidecarFor({ port: 0, token, quietAgentLog: true });
  t.after(() => sidecar.stop());
  sidecar.awaitingFreshSnapshotAfterPair = true;
  recordUnknownNativeAccess(sidecar, { kind: "mutation", code: "HOST_DISPATCH_UNKNOWN" }, sidecar.now().getTime());
  assert.equal(tickReadScheduler(sidecar, "event"), null); assert.equal(sidecar.agentMailbox.length, 0);
  sidecar.releaseNativeFlight(present(sidecar.inFlight).id);
  assert.equal(tickReadScheduler(sidecar, "event")?.reason, "pair"); assert.equal(sidecar.agentMailbox.length, 1);
});

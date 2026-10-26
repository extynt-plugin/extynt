/** The apply item the panel claims carries the reads the sidecar chose; the sidecar judges and merges what the panel posts back. */
import { fieldOf, listOf, readJson, recordOf, textOf } from "./http-json.js";
import type { JsonObject } from "./http-json.js";
import { present } from "./present.js";
import { authorization } from "./sidecar-fixture.js";
import { PANEL, landed, read } from "./read-fixture.js";
import assert from "node:assert/strict";
import test from "node:test";

type Harness = Awaited<ReturnType<typeof landed>>;
const call = async (h: Harness, name: string, args: JsonObject) => readJson(await fetch(`${h.base}/v1/mcp/tools/call`, {
  method: "POST", headers: { ...authorization, "content-type": "application/json", "x-ae-client": "agent", ...PANEL }, body: JSON.stringify({ name, arguments: { waitSeconds: 0, ...args } }),
}));

async function claimedRename(h: Harness, stamp: { revision: number; items: number }) {
  const proposed = await call(h, "ae_propose_plan", { summary: "Rename a layer", operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name: "Renamed" }] });
  const planId = textOf(proposed, "data.planId");
  assert.equal(textOf(await call(h, "ae_approve_plan", { planId, acknowledgeUnverified: true }), "data.status"), "approved");
  const claimed = await h.claim(stamp);
  assert.equal(claimed.status, 200); assert.equal(textOf(claimed.body, "item.planId"), planId);
  return { planId, item: recordOf(claimed.body, "item") };
}

test("an apply claimed while AE still shows what the sidecar last read skips its precheck and carries the stamp to compare", async (t) => {
  const h = await landed(t), { item } = await claimedRename(h, { revision: 10, items: 2 });
  assert.equal(fieldOf(item, "reads.precheck"), null);
  assert.deepEqual(fieldOf(item, "command.expectedStamp"), { epoch: 3, revision: 10 });
  assert.deepEqual(fieldOf(item, "reads.expectedStamp"), { epoch: 3, revision: 10 });
  assert.deepEqual(listOf(item, "reads.preApply.result.compositions").map((composition) => textOf(composition, "id")), ["comp-1"], "the comparison the panel keeps holds only the plan's composition");
  assert.deepEqual(recordOf(item, "reads.verify.read"), { scope: "compositions", compositionIds: ["comp-1"], includeItems: false });
  assert.match(textOf(item, "reads.verify.readId"), /^read-/);
});

test("an apply claimed after AE moved on reads what the plan names first, and the sidecar carries no stamp to compare", async (t) => {
  const h = await landed(t), { item } = await claimedRename(h, { revision: 11, items: 2 });
  assert.deepEqual(recordOf(item, "reads.precheck.read"), { scope: "compositions", compositionIds: ["comp-1"], includeItems: false });
  assert.equal(fieldOf(item, "command.expectedStamp"), undefined); assert.equal(fieldOf(item, "reads.preApply"), undefined);
});

test("the sidecar judges the precheck read: admitted when the project and selection are the plan's, refused with its reason otherwise", async (t) => {
  const h = await landed(t), { planId, item } = await claimedRename(h, { revision: 11, items: 2 });
  const path = `/v1/snapshots?purpose=precheck&planId=${encodeURIComponent(planId)}`, id = textOf(item, "reads.precheck.readId");
  const scoped = (requestId: string, over: Parameters<typeof read>[2] = {}) => read(requestId, 11, { scoped: { items: "skipped" }, compositions: ["comp-1"], ...over });
  const ok = await h.post(path, scoped(id));
  assert.equal(ok.status, 201); assert.deepEqual(fieldOf(await readJson(ok), "admission"), { ok: true });
  const moved = await readJson(await h.post(path, scoped("p2", { selected: [] })));
  assert.equal(textOf(moved, "admission.code"), "SELECTION_CHANGED"); assert.match(textOf(moved, "admission.text"), /nothing was run/);
  const edited = await readJson(await h.post(path, scoped("p3", { name: "Edited meanwhile" })));
  assert.equal(textOf(edited, "admission.code"), "STALE_SNAPSHOT");
  assert.equal(fieldOf(await readJson(await h.post("/v1/snapshots", scoped("p4"))), "admission"), undefined, "a post that is not a precheck gets no verdict");
  const unknown = await readJson(await h.post("/v1/snapshots?purpose=precheck&planId=plan-nobody", scoped("p5")));
  assert.equal(textOf(unknown, "admission.code"), "PLAN_UNKNOWN");
});

test("the verify read is merged and answered with the project's fingerprint, and the next claims at that revision ask for nothing", async (t) => {
  const h = await landed(t), { planId, item } = await claimedRename(h, { revision: 10, items: 2 });
  assert.equal((await h.post("/v1/pipeline", { event: "apply-begin", detail: `${planId} 1 operations` })).status, 200);
  const verify = await h.post("/v1/snapshots", read(textOf(item, "reads.verify.readId"), 12, { name: "Renamed", scoped: { items: "skipped" }, compositions: ["comp-1"] }));
  assert.equal(verify.status, 201);
  const after = textOf(await readJson(verify), "fingerprint");
  assert.equal(after, present(h.sidecar.normalizedLatest(), "the stored project").fingerprint, "the receipt's afterFingerprint is the merged project's");
  assert.equal((await h.post("/v1/receipts", { planId, operation: "apply_plan", status: "executed", postcondition: "passed", appliedOperations: ["set_layer_name"], mayHaveMutated: true, mutationState: "applied", approvalId: textOf(item, "approval.token"), afterFingerprint: after })).status, 201);
  for (let beat = 0; beat < 4; beat += 1) {
    h.clock.ms += 1500;
    const claimed = await h.claim({ revision: 12, items: 2 });
    assert.equal(fieldOf(claimed.body, "item"), null, "no third read after an apply");
  }
  assert.equal(h.refreshes().length, 0);
});

test("an undo item carries a whole-project guard read and a read of the plan's composition for after", async (t) => {
  const h = await landed(t), { planId, item } = await claimedRename(h, { revision: 10, items: 2 });
  assert.equal((await h.post("/v1/pipeline", { event: "apply-begin", detail: `${planId} 1 operations` })).status, 200);
  const verify = await h.post("/v1/snapshots", read(textOf(item, "reads.verify.readId"), 12, { name: "Renamed", scoped: { items: "skipped" }, compositions: ["comp-1"] }));
  const after = textOf(await readJson(verify), "fingerprint");
  await h.post("/v1/receipts", { planId, operation: "apply_plan", status: "executed", postcondition: "passed", appliedOperations: ["set_layer_name"], mayHaveMutated: true, mutationState: "applied", approvalId: textOf(item, "approval.token"), afterFingerprint: after, undoGroups: 1 });
  await h.focus({ revision: 12 });
  const undo = await call(h, "ae_undo_plan", { planId });
  assert.equal(textOf(undo, "data.status"), "undo_requested", JSON.stringify(undo).slice(0, 300));
  const queued = h.sidecar.agentMailbox.map((entry) => entry.approvedData).find((data) => data.kind === "undo_plan");
  assert.deepEqual(fieldOf(queued, "reads.guard.read"), { scope: "full" }, "Edit > Undo is global: the guard cannot be a merge");
  assert.deepEqual(fieldOf(queued, "reads.after.read"), { scope: "compositions", compositionIds: ["comp-1"], includeItems: false });
});

test("the pre-apply stamp a panel still holds once its apply is over does not make the fresh verify read look out of date", async (t) => {
  const h = await landed(t);
  await h.claim({ revision: 10, items: 2 });
  h.clock.ms += 3000;
  assert.equal((await h.post("/v1/snapshots", read("verify-3s", 12, { name: "Renamed", scoped: { items: "skipped" }, compositions: ["comp-1"] }))).status, 201);
  h.clock.ms += 500;
  h.sidecar.liveStamp = { epoch: 3, revision: 10, items: 2, at: h.clock.ms - 3500 };
  const claimed = (await h.claim()).body;
  assert.equal(fieldOf(claimed, "item"), null, "a stamp older than the newest read cannot contradict it"); assert.equal(h.refreshes().length, 0);
  h.clock.ms += 1000;
  const next = (await h.claim({ revision: 12, items: 2 })).body;
  assert.equal(fieldOf(next, "item"), null, "and the pulse after it agrees with the read");
});

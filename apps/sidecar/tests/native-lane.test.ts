/** The host link and lane: offline refusals, stall reporting, host-closing, reconnection, and the lane's own bookkeeping. */
import assert from "node:assert/strict";
import test from "node:test";
import { late, ok, stall } from "@extynt/fake-plugin";
import { hostStatusView } from "../src/host/facts.js";
import { READ_COALESCE_MS } from "../src/host/events.js";
import { uiEventsFor } from "../src/ui-events.js";
import { fieldOf } from "./http-json.js";
import { COMP, nativeRig, until } from "./native-rig.js";

test("the link pairs the sidecar to the plugin: its instance id, build and a fresh-read requirement", async (t) => {
  const rig = await nativeRig(t, { skipRefresh: true });
  const status = rig.sidecar.hostLink.status();
  assert.equal(status.state, "online");
  assert.match(status.instanceId ?? "", /^native:\d+:1$/);
  assert.equal(rig.sidecar.activePanelInstanceId, status.instanceId);
  assert.equal(rig.sidecar.panelBuild, `plugin ${rig.plugin.state.pluginVersion}`);
  assert.equal(status.aeVersion, rig.plugin.state.aeVersion);
  assert.equal(hostStatusView(rig.sidecar).online, true);
});

test("when After Effects closes the sidecar stays up, answers status, and refuses work with HOST_OFFLINE", async (t) => {
  const rig = await nativeRig(t);
  const planId = await rig.proposeRename();
  rig.plugin.hostClosing();
  await until(() => rig.sidecar.hostLink.status().state === "offline");
  const status = await rig.agent("ae_status");
  assert.equal(status.status, 200);
  assert.equal(fieldOf(status.body, "data.pipeline.panel"), "offline");
  assert.match(String(fieldOf(status.body, "data.pipeline.hint")), /Open After Effects/);
  assert.equal(fieldOf(status.body, "data.pipeline.host.state"), "offline");
  const refused = await rig.agent("ae_approve_plan", { planId });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error?.code, "HOST_OFFLINE");
  assert.equal(rig.sidecar.plans.get(planId)?.status, "prepared", "nothing was queued");
  const ui = await rig.ui("ae_approve_plan", { planId });
  assert.equal(ui.body.error?.code, "HOST_OFFLINE", "the panel's own approval is refused the same way");
  assert.equal(hostStatusView(rig.sidecar).online, false);
});

test("a connection that drops is picked up again with backoff and paired anew", async (t) => {
  const rig = await nativeRig(t);
  const first = rig.sidecar.hostLink.status().instanceId;
  rig.plugin.dropConnections();
  await until(() => rig.sidecar.hostLink.status().state !== "online");
  await until(() => rig.sidecar.hostLink.status().state === "online");
  const second = rig.sidecar.hostLink.status().instanceId;
  assert.notEqual(second, first);
  assert.equal(rig.sidecar.activePanelInstanceId, second);
  assert.equal(rig.sidecar.awaitingFreshSnapshotAfterPair || rig.sidecar.latest !== undefined, true);
});

test("a plugin that starts after the sidecar is found through its discovery file", async (t) => {
  const rig = await nativeRig(t, { plugin: { writeDiscovery: false }, skipRefresh: true, noLinkWait: true });
  assert.equal(rig.sidecar.hostLink.status().state, "offline");
  assert.match(String(rig.sidecar.hostLink.status().reason), /not found|After Effects/i);
  rig.plugin.writeDiscovery();
  await until(() => rig.sidecar.hostLink.status().state === "online");
});

test("a long call shows its stall verdict in ae_status and clears when it finishes", async (t) => {
  const rig = await nativeRig(t, { sidecar: { hostStallAfterMs: 80 } });
  rig.plugin.state.idleAgeMs = 4000;
  rig.plugin.hostCalls.set("aeApplyPlan", () => late(900, ok(JSON.stringify({ ok: true, steps: [{ operation: "set_layer_name" }], undoGroups: 1 }))));
  const planId = await rig.proposeRename();
  rig.setLive();
  await rig.agent("ae_approve_plan", { planId });
  await until(() => rig.sidecar.hostLink.status().state === "stalled");
  const status = await rig.agent("ae_status");
  assert.equal(fieldOf(status.body, "data.pipeline.panel"), "stalled");
  assert.equal(fieldOf(status.body, "data.pipeline.host.stall.verdict"), "ae-busy");
  assert.match(String(fieldOf(status.body, "data.pipeline.hint")), /busy/);
  assert.equal(hostStatusView(rig.sidecar).stall?.verdict, "ae-busy");
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
  await until(() => rig.sidecar.hostLink.status().state === "online");
});

test("a dialog open during a call is named in the status line and in ae_status", async (t) => {
  const rig = await nativeRig(t, { sidecar: { hostStallAfterMs: 80 } });
  rig.plugin.state.waitingOnDialog = { title: "Select a LUT file", sinceMs: 2500 };
  rig.plugin.hostCalls.set("aeApplyPlan", () => late(900, ok(JSON.stringify({ ok: true, steps: [{ operation: "set_layer_name" }], undoGroups: 1 }))));
  const planId = await rig.proposeRename();
  rig.setLive();
  await rig.agent("ae_approve_plan", { planId });
  await until(() => rig.sidecar.hostLink.status().state === "stalled");
  assert.equal(hostStatusView(rig.sidecar).message, "After Effects is waiting for you in the \u201CSelect a LUT file\u201D window");
  const status = await rig.agent("ae_status");
  assert.equal(fieldOf(status.body, "data.pipeline.host.stall.waitingOnDialog"), "Select a LUT file");
  rig.plugin.state.waitingOnDialog = null;
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
});

test("a runner that fails is settled honestly instead of wedging the lane", async (t) => {
  const rig = await nativeRig(t);
  rig.sidecar.nativeHost?.lane.registry.register("capture_frame", () => Promise.reject(new Error("the runner broke")));
  const captured = await rig.agent("ae_capture_composition_frame", { time: 1 });
  const captureId = String(fieldOf(captured.body, "data.captureId"));
  await until(() => rig.sidecar.captures.get(captureId)?.status === "failed");
  assert.equal(fieldOf(rig.sidecar.captures.get(captureId)?.receipt, "error.code"), "CAPTURE_LOST");
  assert.equal(rig.sidecar.inFlight, undefined, "the lane is free for the next item");
  assert.ok(rig.logged.some((entry) => entry.event === "host.runner-failed"));
});

test("status changes poke the UI event hub and wake waiters", async (t) => {
  const rig = await nativeRig(t);
  let pokes = 0;
  uiEventsFor(rig.sidecar).subscribe((event) => { if (event.type === "poke") pokes += 1; });
  rig.plugin.hostClosing();
  await until(() => rig.sidecar.hostLink.status().state === "offline");
  assert.ok(pokes >= 2, "closing and then offline");
});

test("a lane wake with an event stamp ahead of the snapshot does not read before the coalescing window closes", async (t) => {
  const rig = await nativeRig(t);
  const before = rig.batches().length, revision = (rig.plugin.state.watch.revision ?? 0) + 1, started = Date.now();
  rig.plugin.change({ revision });
  await until(() => rig.sidecar.liveStamp?.revision === revision, 1000);
  rig.sidecar.nativeHost?.lane.wake();
  await new Promise((resolve) => { setTimeout(resolve, 60); });
  assert.equal(rig.batches().length, before, "the edit is read once, when its window closes, and not by the wake");
  await until(() => rig.batches().length > before);
  assert.ok(Date.now() - started >= READ_COALESCE_MS - 30, `the read waited for the ${READ_COALESCE_MS} ms window`);
  assert.equal(rig.batches().slice(before).map((ops) => ops.filter((op) => op === "read_comp").length).reduce((sum, count) => sum + count, 0), 1, "one read for the one edit");
});

test("a collection page obeys the host call timeout: a page the plugin never answers fails its demand in time", async (t) => {
  const rig = await nativeRig(t, { sidecar: { hostCallTimeoutMs: 300 } });
  rig.plugin.hostCalls.set("aeCollectDetailPage", () => stall());
  const started = await rig.agent("ae_read_graph_page", { target: { kind: "layers", compositionId: COMP, itemIndex: 1 } });
  const demandId = String(fieldOf(started.body, "data.demandId"));
  await until(() => rig.sidecar.collection.demandResult(demandId).state === "unknown", 3000);
  assert.equal(fieldOf(rig.sidecar.collection.demandResult(demandId), "error.code"), "HOST_TIMEOUT");
});

const layerRow = { id: "1", index: 1, layerIndex: 1, name: "Layer 1", locked: false, selected: false, detail: "layer-index", properties: "unknown", values: "not-read" };
const layersPage = (requestId: string) => ({ ok: true, requestId, sessionId: "detail-1", stamp: { epoch: 1, revision: 100 }, kind: "layers", rows: [layerRow], nextCursor: null, deepComplete: false, metadata: { activeCompositionId: COMP, runtime: { application: "After Effects" }, project: { name: "Test.aep", filePath: null }, composition: { id: COMP, itemIndex: 1, name: "Main", width: 1920, height: 1080, duration: 10, frameRate: 30 }, layerCount: 1 } });

test("a collection demand made while a capture holds the lane queues and runs after it, instead of failing as busy", async (t) => {
  const rig = await nativeRig(t);
  rig.plugin.hostCalls.set("aeCaptureFrame", () => late(600, ok({ ok: false, error: { code: "CAPTURE_FIXTURE", message: "no frame" } })));
  rig.plugin.hostCalls.set("aeCollectDetailPage", (args) => ok(layersPage(String(args.requestId))));
  await rig.agent("ae_capture_composition_frame", { time: 1 });
  await until(() => rig.sidecar.inFlight?.kind === "capture_frame");
  const started = await rig.agent("ae_read_graph_page", { target: { kind: "layers", compositionId: COMP, itemIndex: 1 } });
  assert.equal(fieldOf(started.body, "data.state"), "pending", JSON.stringify(started.body));
  const demandId = String(fieldOf(started.body, "data.demandId"));
  await until(() => rig.sidecar.collection.demandResult(demandId).state === "observed", 5000);
});

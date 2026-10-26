/** With After Effects closed or restarted: cached reads say so and say how old they are, graph pages refuse, and ae_status does not report old or failed work as current. */
import assert from "node:assert/strict";
import test from "node:test";
import { MCP_SERVER_VERSION } from "@extynt/mcp-server";
import { late, ok, refuse, toWire } from "@extynt/fake-plugin";
import { authorization, censusAnswer } from "./sidecar-fixture.js";
import { fieldOf, readJson } from "./http-json.js";
import { COMP, nativeRig, until } from "./native-rig.js";
import { present } from "./present.js";

async function rawAgent(base: string, name: string): ReturnType<typeof readJson> {
  const headers = { ...authorization, "content-type": "application/json", "X-AE-Client": "agent", "X-AE-Client-Version": MCP_SERVER_VERSION };
  const response = await fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers, body: JSON.stringify({ name, arguments: { waitSeconds: 0 } }) });
  return readJson(response);
}

async function closed(t: Parameters<typeof nativeRig>[0]) {
  const rig = await nativeRig(t);
  rig.plugin.hostClosing();
  await until(() => rig.sidecar.hostLink.status().state === "offline");
  return rig;
}

test("a read tool answers from the last read with an offline note that carries the read time and age", async (t) => {
  const rig = await closed(t);
  const result = await rawAgent(rig.base, "ae_get_project_overview");
  assert.equal(fieldOf(result, "ok"), true);
  const note = String(fieldOf(result, "focusNote"));
  assert.match(note, /^From the last read at \d{4}-\d\d-\d\dT[\d:.]+Z \(\d+ s ago\); After Effects is not connected/);
  assert.notEqual(fieldOf(result, "snapshotFingerprint"), null, "the cached answer is still given");
});

test("a read tool has no offline note while After Effects is connected", async (t) => {
  const rig = await nativeRig(t);
  const result = await rawAgent(rig.base, "ae_get_project_overview");
  assert.equal(fieldOf(result, "focusNote"), undefined);
});

test("a graph page demand is refused with HOST_OFFLINE while After Effects is closed, and nothing is queued", async (t) => {
  const rig = await closed(t);
  const queued = rig.sidecar.agentMailbox.length;
  const result = await rig.agent("ae_read_graph_page", { target: { kind: "layers", compositionId: COMP, itemIndex: 1 } });
  assert.equal(result.body.ok, false);
  assert.equal(result.body.error?.code, "HOST_OFFLINE");
  assert.equal(rig.sidecar.agentMailbox.length, queued);
});

test("ae_status shows a census that failed and a library that is missing, with code, message and time", async (t) => {
  const rig = await nativeRig(t, { plugin: { hostCalls: { aeHostCensus: () => refuse("LIBRARY_NOT_FOUND", "the host library was not found") } } });
  await until(() => rig.sidecar.hostFacts.checks.census !== null);
  const status = await rig.agent("ae_status");
  assert.equal(fieldOf(status.body, "data.hostLibrary.ok"), false);
  assert.equal(fieldOf(status.body, "data.hostLibrary.census.code"), "LIBRARY_NOT_FOUND");
  assert.equal(fieldOf(status.body, "data.hostLibrary.library.message"), "the host library was not found");
  assert.match(String(fieldOf(status.body, "data.hostLibrary.census.at")), /^\d{4}-/);
});

test("ae_status reports hostLibrary ok after a census that worked", async (t) => {
  const rig = await nativeRig(t, { plugin: { hostCalls: { aeHostCensus: (args) => ok(toWire(censusAnswer(args, 2))) } } });
  await until(() => rig.sidecar.inventory !== undefined);
  const status = await rig.agent("ae_status");
  assert.equal(fieldOf(status.body, "data.hostLibrary.ok"), true);
});

test("until the new instance's first read lands, work and ready plans from the earlier one are not reported as current", async (t) => {
  const rig = await nativeRig(t);
  const planId = await rig.proposeRename();
  rig.setLive();
  await rig.agent("ae_approve_plan", { planId });
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
  const record = present(rig.sidecar.plans.get(planId));
  rig.sidecar.readyPlans.push({ planId, batch: 1, jobId: null, jobBatch: null, operations: 1, undoGroups: 1, completedAt: record.updatedAt, deliveredAt: null, requestId: null, autoApply: false });
  const before = await rig.agent("ae_status");
  assert.equal(fieldOf(before.body, "data.latestWork.status"), "verified");
  assert.equal(fieldOf(before.body, "data.pipeline.readyPlans.waiting"), 1);
  const first = rig.sidecar.hostLink.status().instanceId;
  rig.plugin.handlers.set("watch_state", (_request, plugin) => late(1500, ok(plugin.state.watch)));
  rig.plugin.dropConnections();
  await until(() => rig.sidecar.hostLink.status().state === "online" && rig.sidecar.hostLink.status().instanceId !== first);
  const after = await rig.agent("ae_status");
  assert.equal(fieldOf(after.body, "data.latestWork.status"), "earlier_session");
  assert.equal(fieldOf(after.body, "data.latestWork.planStatus"), "verified");
  assert.match(String(fieldOf(after.body, "data.latestWork.note")), /earlier After Effects session/);
  assert.equal(fieldOf(after.body, "data.pipeline.readyPlans"), undefined);
  assert.equal(fieldOf(after.body, "data.pipeline.readyPlansFromEarlierSession.count"), 1);
});

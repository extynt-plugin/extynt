/** The "before" frame: asked for ahead of the apply for every plan a frame can show, whoever proposed it and however it is approved. */
import type { JsonArray, JsonObject } from "@extynt/decode";
import assert from "node:assert/strict";
import test from "node:test";
import { ok, toWire } from "@extynt/fake-plugin";
import type { HostCallHandler } from "@extynt/fake-plugin";
import { authorization } from "./sidecar-fixture.js";
import { fieldOf, listOf, readJson } from "./http-json.js";
import type { Found } from "./http-json.js";
import { uiHostOf } from "../src/ui-host.js";
import { COMP, LAYER, nativeRig, until, type NativeRig } from "./native-rig.js";
import { frameDirectory, solidPng } from "./png-fixture.js";
import { present } from "./present.js";

const frames = frameDirectory();

const savesFrame: HostCallHandler = (args) => {
  const captureId = String(args.captureId), localPath = frames.write(`${captureId}.png`, solidPng(480, 270));
  return ok(toWire({ ok: true, operation: "capture_frame", captureId, compositionId: args.compositionId, time: args.time, width: 480, height: 270, format: "png", storage: "userData", fileExists: true, localPath, providerShared: false }));
};

async function proposePosition(rig: NativeRig): Promise<string> {
  const proposed = await rig.agent("ae_propose_plan", { summary: "Move the layer", operations: [{ type: "set_layer_property", target: { compositionId: COMP, layerId: LAYER }, role: "transform.position", propertyPath: "ADBE Transform Group/ADBE Position", value: [100, 100] }] });
  assert.equal(proposed.body.ok, true, JSON.stringify(proposed.body));
  return String(proposed.body.data && typeof proposed.body.data === "object" && "planId" in proposed.body.data ? proposed.body.data.planId : "");
}

async function listedRows(rig: NativeRig): Promise<JsonArray> {
  const response = await fetch(`${rig.base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", "X-AE-Client": "panel" }, body: JSON.stringify({ name: "ae_list_plans", arguments: { limit: 5 } }) });
  return listOf(await readJson(response), "data");
}

const visualOf = (rows: JsonArray, planId: string): Found => fieldOf(rows.find((row) => fieldOf(row, "planId") === planId), "visual");

const order = (rig: NativeRig): string[] => rig.logged.filter((entry) => entry.event === "host.item-done" && (entry.fields.kind === "capture_frame" || entry.fields.kind === "apply_plan")).map((entry) => String(entry.fields.kind));

test("an auto-applied visual plan is pictured before it is written", async (t) => {
  const rig = await nativeRig(t, { plugin: { hostCalls: { aeCaptureFrame: savesFrame } } });
  const planId = await proposePosition(rig);
  rig.sidecar.queueReadyPlan({ planId, operationCount: 1 }, { requestId: "turn-1", autoApply: true });
  await until(() => order(rig).includes("apply_plan"));
  assert.deepEqual(order(rig).slice(0, 2), ["capture_frame", "apply_plan"]);
  assert.ok(uiHostOf(rig.sidecar)?.frames.thumbsFor(planId)?.before, "the before frame is there");
});

test("a plan thumbnail asks the host to keep the comp's preview resolution, so it writes nothing next to the plan's undo group", async (t) => {
  const asked: Array<JsonObject> = [];
  const recording: HostCallHandler = (args, request, plugin) => { asked.push({ ...args }); return savesFrame(args, request, plugin); };
  const rig = await nativeRig(t, { plugin: { hostCalls: { aeCaptureFrame: recording } } });
  const planId = await proposePosition(rig);
  rig.sidecar.queueReadyPlan({ planId, operationCount: 1 }, { requestId: "turn-1", autoApply: true });
  await until(() => order(rig).includes("apply_plan"));
  assert.ok(asked.length >= 1, "the before frame was asked for");
  assert.equal(present(asked[0]).keepResolution, true, "a resolution switch and restore would be loose undo steps right before the apply");
});

test("an external agent's approval asks for the before frame ahead of the apply", async (t) => {
  const rig = await nativeRig(t, { plugin: { hostCalls: { aeCaptureFrame: savesFrame } } });
  const planId = await proposePosition(rig);
  const approved = await rig.agent("ae_approve_plan", { planId, waitSeconds: 10 });
  assert.equal(approved.body.ok, true, JSON.stringify(approved.body));
  await until(() => order(rig).includes("apply_plan"));
  assert.deepEqual(order(rig).slice(0, 2), ["capture_frame", "apply_plan"]);
  assert.ok(uiHostOf(rig.sidecar)?.frames.thumbsFor(planId)?.before);
});

test("a rename shows nothing a frame could show, so it takes no frame at all", async (t) => {
  const rig = await nativeRig(t, { plugin: { hostCalls: { aeCaptureFrame: savesFrame } } });
  const planId = await rig.proposeRename();
  rig.sidecar.queueReadyPlan({ planId, operationCount: 1 }, { requestId: "turn-1", autoApply: true });
  await until(() => order(rig).includes("apply_plan"));
  assert.deepEqual(order(rig), ["apply_plan"]);
  assert.equal(visualOf(await listedRows(rig), planId), false);
});

test("a waiting visual plan is pictured when idle, and pressing Apply first replaces that request with one ahead of the apply", async (t) => {
  const rig = await nativeRig(t, { plugin: { hostCalls: { aeCaptureFrame: savesFrame } } });
  const planId = await proposePosition(rig);
  assert.equal(visualOf(await listedRows(rig), planId), true);
  rig.sidecar.inFlight = { kind: "refresh_snapshot", id: "held", claimedAt: Date.now() };
  assert.equal(rig.sidecar.hostFacts.capturePlan?.(planId, "before", "idle"), true);
  assert.equal(rig.sidecar.agentMailbox.length, 0, "an idle capture waits outside the mailbox");
  assert.equal(rig.sidecar.hostFacts.capturePlan?.(planId, "before", "ahead"), true);
  assert.equal(rig.sidecar.agentMailbox[0]?.approvedData.kind, "capture_frame", "the ahead capture is at the front");
  assert.equal(rig.sidecar.agentMailbox.filter((item) => item.approvedData.kind === "capture_frame").length, 1);
});

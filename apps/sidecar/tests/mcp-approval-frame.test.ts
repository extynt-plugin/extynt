/** An external agent's approval carries the measured frame the panel's own seal would take, and a capture that cannot land costs it a note, not the approval. */
import assert from "node:assert/strict";
import test from "node:test";
import { ok, refuse, toWire } from "@extynt/fake-plugin";
import type { HostCallHandler } from "@extynt/fake-plugin";
import { fieldOf, listOf } from "./http-json.js";
import { COMP, LAYER, nativeRig, type NativeRig } from "./native-rig.js";
import { frameDirectory, solidPng } from "./png-fixture.js";

const frames = frameDirectory();

const savesFrame: HostCallHandler = (args) => {
  const captureId = String(args.captureId), width = Number(args.width), height = Number(args.height), localPath = frames.write(`${captureId}.png`, solidPng(width, height));
  return ok(toWire({ ok: true, operation: "capture_frame", captureId, compositionId: args.compositionId, time: args.time, width, height, format: "png", storage: "userData", fileExists: true, localPath, providerShared: false }));
};

const failsFrame: HostCallHandler = () => refuse("CAPTURE_UNAVAILABLE", "no frame");

const POSITION = "ADBE Transform Group/ADBE Position";
const MOVE = { type: "animate_property", target: { compositionId: COMP, layerId: LAYER, propertyPath: POSITION }, role: "transform.position", keyframes: [{ time: 0, value: [0, 0] }, { time: 0.5, value: [50, 50] }, { time: 1, value: [100, 100] }] };

async function propose(rig: NativeRig, apply: boolean): ReturnType<NativeRig["agent"]> {
  return rig.agent("ae_propose_plan", { summary: "Move the layer", operations: [MOVE], ...(apply ? { apply: true, acknowledgeUnverified: true, waitSeconds: 10 } : {}) });
}

test("an approved animation's receipt carries a compact measured frame at its own keyframe times", async (t) => {
  const rig = await nativeRig(t, { plugin: { hostCalls: { aeCaptureFrame: savesFrame } } });
  const proposed = await propose(rig, false);
  const planId = String(fieldOf(proposed.body, "data.planId"));
  const approved = await rig.agent("ae_approve_plan", { planId, waitSeconds: 10, acknowledgeUnverified: true });
  assert.equal(approved.body.ok, true, JSON.stringify(approved.body));
  const frame = fieldOf(approved.body, "data.receipt.frame");
  assert.ok(frame, JSON.stringify(approved.body));
  assert.equal(fieldOf(frame, "composition"), COMP, JSON.stringify(frame));
  assert.deepEqual(listOf(frame, "times"), [0.5, 1]);
  assert.ok(listOf(frame, "measured").length > 0);
  assert.ok(JSON.stringify(frame).length <= 800, "the frame block stays bounded");
  assert.equal(JSON.stringify(approved.body).includes("base64"), false, "no image bytes in the text result");
});

test("propose+apply folds the same frame into its apply receipt", async (t) => {
  const rig = await nativeRig(t, { plugin: { hostCalls: { aeCaptureFrame: savesFrame } } });
  const applied = await propose(rig, true);
  assert.equal(applied.body.ok, true, JSON.stringify(applied.body));
  assert.ok(listOf(fieldOf(applied.body, "data.apply.receipt.frame"), "measured").length > 0, JSON.stringify(applied.body));
});

test("a capture that fails leaves a note and the approval stands", async (t) => {
  const rig = await nativeRig(t, { plugin: { hostCalls: { aeCaptureFrame: failsFrame } } });
  const proposed = await propose(rig, false);
  const planId = String(fieldOf(proposed.body, "data.planId"));
  const approved = await rig.agent("ae_approve_plan", { planId, waitSeconds: 10, acknowledgeUnverified: true });
  assert.equal(approved.body.ok, true, JSON.stringify(approved.body));
  assert.match(String(fieldOf(approved.body, "data.receipt.frame.note")), /Not measured/);
  assert.ok(["applied", "verified", "applied_unverified"].includes(String(fieldOf(approved.body, "data.status"))));
});

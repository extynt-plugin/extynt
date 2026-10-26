/**
 * Apply and undo read the same kinds of detail a normal read does, ask for them only on the layers the plan touches, and fold every other layer's
 * row from what the sidecar already holds, so the fingerprints of all read paths stay comparable.
 */
import type { JsonObject } from "@extynt/decode";
import assert from "node:assert/strict";
import test from "node:test";
import { array, decode, decodeJson, jsonObject, object, optional } from "@extynt/decode";
import { queueSnapshotRefresh, refreshPending } from "../src/read-queue.js";
import { rowList } from "../src/verify/json-fields.js";
import { fieldOf } from "./http-json.js";
import { COMP, LAYER, nativeProject, nativeRig, until, type NativeRig } from "./native-rig.js";

const ALL_KINDS = ["textDocument", "keyDigest", "marker", "maskPath", "shapePath", "layerRef"];
const DETAILS = "host_call:aeReadPropertyDetails";

const wide = (t: Parameters<typeof nativeRig>[0]) => nativeRig(t, { plugin: { project: nativeProject(2) } });

const looseDetailCalls = (rig: NativeRig): number => rig.plugin.requestsFor("host_call").filter((request) => request.body.entry === "aeReadPropertyDetails").length;

async function approved(rig: NativeRig, planId: string): Promise<void> {
  await rig.agent("ae_approve_plan", { planId });
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
}

async function applied(rig: NativeRig, name = "Renamed"): Promise<string> {
  const planId = await rig.proposeRename(name);
  rig.setLive();
  await approved(rig, planId);
  assert.equal(rig.sidecar.plans.get(planId)?.receipt?.postcondition, "passed", JSON.stringify(rig.sidecar.plans.get(planId)?.receipt));
  return planId;
}

async function readEverything(rig: NativeRig): Promise<void> {
  queueSnapshotRefresh(rig.sidecar, { reason: "edit", read: { scope: "full" } });
  rig.sidecar.nativeHost?.lane.wake();
  await until(() => !refreshPending(rig.sidecar));
}

function newestDetailsArgs(rig: NativeRig): JsonObject | undefined {
  const texts = rig.plugin.requestsFor("batch").flatMap((request) => {
    const text = (request.body.ops ?? []).find((op) => op?.entry === "aeReadPropertyDetails")?.args;
    return text === undefined ? [] : [text];
  });
  const text = texts.at(-1);
  const parsed = text === undefined ? undefined : decodeJson(text, jsonObject);
  return parsed?.ok ? parsed.value : undefined;
}

const storedShape = object({ compositions: array(object({ layers: optional(rowList) })) });

function storedLayers(rig: NativeRig): JsonObject[] {
  const stored = decode(storedShape, rig.sidecar.latest?.snapshot.result);
  return stored.ok ? stored.value.compositions.flatMap((composition) => composition.layers ?? []) : [];
}

function propertyOf(layer: JsonObject, matchName: string): JsonObject | undefined {
  const paths = decode(rowList, layer.propertyPaths);
  return paths.ok ? paths.value.find((property) => property.matchName === matchName) : undefined;
}

test("apply then undo on layers holding markers and keyframes restores the pre-apply fingerprint", async (t) => {
  const rig = await wide(t);
  const planId = await applied(rig);
  rig.setLive();
  await rig.agent("ae_undo_plan", { planId });
  await until(() => rig.sidecar.plans.get(planId)?.undoReceipt !== undefined);
  const record = rig.sidecar.plans.get(planId);
  assert.equal(fieldOf(record?.undoReceipt, "undo.restoredPreApplyFingerprint"), true, JSON.stringify(record?.undoReceipt));
  assert.equal(record?.status, "undone");
});

test("an undo that reads the project first still restores the pre-apply fingerprint", async (t) => {
  const rig = await wide(t);
  const planId = await applied(rig);
  rig.sidecar.liveStamp = null;
  await rig.agent("ae_undo_plan", { planId });
  await until(() => rig.sidecar.plans.get(planId)?.undoReceipt !== undefined);
  assert.equal(fieldOf(rig.sidecar.plans.get(planId)?.undoReceipt, "undo.restoredPreApplyFingerprint"), true);
  assert.equal(rig.sidecar.plans.get(planId)?.status, "undone");
});

test("an apply that reads the project first is not refused as stale when nothing changed in After Effects", async (t) => {
  const rig = await wide(t);
  const planId = await rig.proposeRename();
  rig.sidecar.liveStamp = null;
  const batches = rig.batches().length, loose = looseDetailCalls(rig);
  await approved(rig, planId);
  const receipt = rig.sidecar.plans.get(planId)?.receipt;
  assert.equal(receipt?.postcondition, "passed", JSON.stringify(receipt));
  assert.doesNotMatch(JSON.stringify(receipt), /STALE_SNAPSHOT/);
  const [precheck] = rig.batches().slice(batches);
  assert.equal(precheck?.includes(DETAILS), false, "the read before the write is a plain read: nothing moved, so no details are asked");
  assert.equal(looseDetailCalls(rig), loose, "and none are asked afterwards either");
});

test("a read that lands between two plans does not make the second one stale", async (t) => {
  const rig = await wide(t);
  await applied(rig, "First");
  await readEverything(rig);
  const second = await rig.proposeRename("Second");
  rig.sidecar.liveStamp = null;
  await approved(rig, second);
  const receipt = rig.sidecar.plans.get(second)?.receipt;
  assert.equal(receipt?.postcondition, "passed", JSON.stringify(receipt));
});

test("an apply asks for every kind of detail on the touched layers only and keeps every other layer's provenance", async (t) => {
  const rig = await wide(t);
  const loose = looseDetailCalls(rig), planId = await rig.proposeRename();
  rig.setLive();
  await approved(rig, planId);
  const asked = rig.hostCallArgs("aeReadPropertyDetails");
  assert.deepEqual(fieldOf(asked, "scopes"), [{ compId: COMP, layerIds: [LAYER] }]);
  assert.deepEqual(fieldOf(asked, "include"), ALL_KINDS);
  assert.equal(looseDetailCalls(rig), loose, "the layers the plan did not touch need no second call");
  for (const layer of storedLayers(rig)) {
    assert.deepEqual(propertyOf(layer, "ADBE Marker")?.value, [], `layer ${String(layer.id)} keeps its marker list`);
    assert.equal(typeof propertyOf(layer, "ADBE Opacity")?.keyDigest, "string", `layer ${String(layer.id)} keeps its key digest`);
  }
  const after = rig.sidecar.normalizedLatest()?.fingerprint;
  await readEverything(rig);
  assert.equal(rig.sidecar.normalizedLatest()?.fingerprint, after, "a normal read of the unchanged project gives the fingerprint the apply left");
  assert.equal(looseDetailCalls(rig), loose, "and fetches no details: the apply left the hashes of what it stored");
});

test("an undo asks for details of the layers its plan touched only", async (t) => {
  const rig = await wide(t);
  const planId = await applied(rig);
  rig.setLive();
  const before = rig.batches().length;
  await rig.agent("ae_undo_plan", { planId });
  await until(() => rig.sidecar.plans.get(planId)?.undoReceipt !== undefined);
  const [undo] = rig.batches().slice(before);
  assert.ok(undo?.includes("host_call:aeUndoPlan") && undo.includes(DETAILS));
  assert.deepEqual(fieldOf(newestDetailsArgs(rig), "scopes"), [{ compId: COMP, layerIds: [LAYER] }]);
  assert.deepEqual(fieldOf(newestDetailsArgs(rig), "include"), ALL_KINDS);
  const loose = looseDetailCalls(rig);
  await readEverything(rig);
  assert.equal(looseDetailCalls(rig), loose, "the undo left the hashes of what it stored, so the next read fetches no details");
});

test("a layer another edit changed behind the plan's back is read too, so the stored project stays complete", async (t) => {
  const rig = await wide(t);
  const planId = await rig.proposeRename();
  rig.setLive();
  const layer = rig.plugin.state.project.compositions[0]?.layers[1];
  if (layer) layer.name = "Moved meanwhile";
  const loose = looseDetailCalls(rig);
  await approved(rig, planId);
  assert.equal(rig.sidecar.plans.get(planId)?.receipt?.postcondition, "passed");
  assert.equal(looseDetailCalls(rig), loose + 1, "one more call, for the layer whose hash moved");
  const stored = storedLayers(rig).find((candidate) => candidate.name === "Moved meanwhile");
  assert.deepEqual(propertyOf(stored ?? {}, "ADBE Marker")?.value, []);
});

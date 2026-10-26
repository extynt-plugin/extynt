// dolly_camera through ae_queue_add: sorted keyframes, the compose row, and the note on a Position write that leaves the camera's axis.
import test from "node:test";
import assert from "node:assert/strict";
import { callTool, type StoredPlan } from "../src/index.js";
import { createSnapshot, representativeSnapshot, type PropertySnapshot } from "@extynt/project-graph";
import { arrayAt, numberAt, objectsIn, stringsIn } from "../src/json.js";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { resultData, storedOperations } from "./support/json-results.js";

const prop = (path: string, value: number[], extra: Partial<PropertySnapshot> = {}): PropertySnapshot => ({ path, matchName: path.split("/").at(-1) ?? path, displayName: path, kind: "property", valueType: "unknown", value, canSetValue: true, ...extra });
const camera = (withPoi = true) => createSnapshot({
  ...representativeSnapshot,
  compositions: representativeSnapshot.compositions.map((comp) => ({ ...comp, layers: comp.layers.map((layer) => layer.id === "layer-footage" ? { ...layer, id: "layer-camera", name: "Camera 1", type: "camera" as const, properties: [prop("ADBE Transform Group/ADBE Position", [960, 540, -2667]), ...(withPoi ? [prop("ADBE Transform Group/ADBE Anchor Point", [960, 540, 0])] : [])] } : layer) })),
});
const CAMERA = { compositionId: "comp-main", layerId: "layer-camera" };

interface QueueSlot { planId: string | null; set: (id: string | null) => void }
interface Sent { ok: boolean; notes: string[]; text: string }

function queueContext(snapshot = camera()) {
  const queue: QueueSlot = { planId: null, set: (id) => { queue.planId = id; } };
  return { snapshot, plans: new Map<string, StoredPlan>(), queue };
}

function send(context: ReturnType<typeof queueContext>, operations: JsonValue[]): Sent {
  const result = callTool("ae_queue_add", { operations }, context);
  if (!result.ok) return { ok: false, notes: [], text: result.error.message };
  return { ok: true, notes: [...stringsIn(arrayAt(resultData(result), "notes"))], text: JSON.stringify(result.data) };
}

function storedOperation(context: ReturnType<typeof queueContext>): JsonObject {
  const planId = context.queue.planId;
  const operation = storedOperations(planId === null ? undefined : context.plans.get(planId))[0];
  if (!operation) throw new Error("expected a queued operation");
  return operation;
}

const animate = (keyframes: JsonValue[]): JsonObject => ({ type: "animate_property", target: { ...CAMERA, propertyPath: "ADBE Transform Group/ADBE Position" }, role: "transform.position", keyframes });

test("dolly_camera queues on a camera and keeps keyframes sorted by time, with each distance staying with its time", () => {
  const context = queueContext();
  const result = send(context, [{ type: "dolly_camera", target: CAMERA, keyframes: [{ time: 5, distance: 2200 }, { time: 0, distance: 2667 }] }]);
  assert.equal(result.ok, true, result.text);
  const stored = storedOperation(context);
  assert.equal(stored.type, "dolly_camera");
  assert.deepEqual(objectsIn(arrayAt(stored, "keyframes")).map((key) => [numberAt(key, "time"), numberAt(key, "distance")]), [[0, 2667], [5, 2200]]);
});

test("dolly_camera is refused on a non-camera layer with the fix named", () => {
  const result = send(queueContext(), [{ type: "dolly_camera", target: { compositionId: "comp-main", layerId: "layer-title" }, keyframes: [{ time: 0, distance: 2667 }, { time: 5, distance: 2200 }] }]);
  assert.equal(result.text.includes("camera layer"), true, result.text);
});

test("a Position write whose x,y all differ from the camera's own queues, and the note names dolly_camera, the camera position and the point of interest", () => {
  const result = send(queueContext(), [animate([{ time: 0, value: [100, 100, -2667] }, { time: 5, value: [100, 100, -2200] }])]);
  assert.equal(result.ok, true, result.text);
  const note = result.notes.join("\n");
  assert.match(note, /dolly_camera/);
  assert.match(note, /camera is at \(960, 540, -2667\)/);
  assert.match(note, /point of interest \(960, 540, 0\)/);
  assert.match(note, /2667px now/);
});

test("no note when the keys keep the camera's x,y, move x,y by different amounts, or the snapshot has no point of interest", () => {
  assert.equal(send(queueContext(), [animate([{ time: 0, value: [960, 540, -2667] }, { time: 5, value: [960, 540, -2200] }])]).notes.length, 0);
  assert.equal(send(queueContext(), [animate([{ time: 0, value: [100, 100, -2667] }, { time: 5, value: [200, 100, -2200] }])]).notes.length, 0);
  assert.equal(send(queueContext(camera(false)), [animate([{ time: 0, value: [100, 100, -2667] }, { time: 5, value: [100, 100, -2200] }])]).notes.length, 0);
});

test("the note also covers a single set_layer_property Position, and ignores a non-camera layer", () => {
  const set = (target: JsonObject): JsonObject => ({ type: "set_layer_property", target: { ...target, propertyPath: "ADBE Transform Group/ADBE Position" }, role: "transform.position", propertyPath: "ADBE Transform Group/ADBE Position", value: [100, 100, -2000] });
  assert.match(send(queueContext(), [set(CAMERA)]).notes.join(""), /dolly_camera/);
  assert.equal(send(queueContext(), [set({ compositionId: "comp-main", layerId: "layer-title" })]).notes.length, 0);
});

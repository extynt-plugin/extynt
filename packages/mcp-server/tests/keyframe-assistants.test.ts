// Tests for the keyframe assistants: sequence layers, wiggle and smooth, directly and through the tool.
import test from "node:test";
import assert from "node:assert/strict";
import { callTool, listTools } from "../src/index.js";
import { arrayAt, objectAt, stringAt } from "../src/json.js";
import { parsedJson } from "./support/narrow.js";
import { isJsonObject } from "@extynt/decode";
import type { JsonObject } from "@extynt/decode";
import { solveSequenceLayers, solveSmooth, solveWiggle } from "../src/solvers/assistants.js";

const BASE = [100, 200];

const layers = [
  { layerId: "a", inPoint: 0, outPoint: 2, startTime: 0 },
  { layerId: "b", inPoint: 1, outPoint: 4, startTime: 1 },
  { layerId: "c", inPoint: 0, outPoint: 1.5, startTime: -0.5 },
];

function operationsOf(text: string): ReadonlyArray<JsonObject> {
  const root = parsedJson(text);
  return (isJsonObject(root) ? arrayAt(root, "operations") ?? [] : []).filter(isJsonObject);
}

function operationSummary(operation: JsonObject): [string | undefined, string | undefined] {
  return [stringAt(operation, "type"), stringAt(objectAt(operation, "target"), "layerId")];
}

function withinAmplitude(value: number | ReadonlyArray<number>, amplitude: number): boolean {
  const components = typeof value === "number" ? [value] : value;
  return components.every((component, axis) => Math.abs(component - (BASE[axis] ?? Number.NaN)) <= amplitude);
}

test("the keyframe assistant tool is listed for the agent", () => {
  assert.ok(listTools("agent").some((tool) => tool.name === "ae_solve_keyframe_assistant"));
});

test("sequence layers lays each layer after the previous one, keeping its duration and start offset", () => {
  const result = solveSequenceLayers({ layers, startTime: 1 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.items.map((item) => [item.layerId, item.inPoint, item.outPoint]), [["a", 1, 3], ["b", 3, 6], ["c", 6, 7.5]]);
  assert.deepEqual(result.items.map((item) => item.startTime), [1, 3, 5.5]);
  assert.equal(result.end, 7.5);
});

test("sequence layers overlaps, reverses, and refuses an overlap as long as a layer", () => {
  const overlapped = solveSequenceLayers({ layers, overlap: 0.5 });
  assert.ok(overlapped.ok);
  if (overlapped.ok) assert.deepEqual(overlapped.items.map((item) => item.inPoint), [0, 1.5, 4]);
  const backwards = solveSequenceLayers({ layers, reverse: true, startTime: 0 });
  assert.ok(backwards.ok);
  if (backwards.ok) assert.deepEqual(backwards.items.map((item) => item.layerId), ["c", "b", "a"]);
  assert.equal(solveSequenceLayers({ layers, overlap: 1.5 }).ok, false);
  assert.equal(solveSequenceLayers({ layers: layers.slice(0, 1) }).ok, false);
});

test("wiggle is seeded, bounded by the amplitude, and can settle on the base value", () => {
  const input = { base: BASE, amplitude: 10, frequency: 4, startTime: 1, duration: 2, seed: 7, settle: true };
  const first = solveWiggle(input), second = solveWiggle(input), other = solveWiggle({ ...input, seed: 8 });
  assert.ok(first.ok && second.ok && other.ok);
  if (!first.ok || !second.ok || !other.ok) return;
  assert.deepEqual(first.keyframes, second.keyframes);
  assert.notDeepEqual(first.keyframes, other.keyframes);
  assert.equal(first.keyframes.length, 9);
  assert.deepEqual(first.keyframes[0], { time: 1, value: [100, 200] });
  assert.deepEqual(first.keyframes[8], { time: 3, value: [100, 200] });
  assert.ok(first.keyframes.every((key) => withinAmplitude(key.value, 10)));
});

test("wiggle returns plain numbers for a scalar base and refuses unbounded work", () => {
  const scalar = solveWiggle({ base: 50, amplitude: 5, frequency: 2, startTime: 0, duration: 1 });
  assert.ok(scalar.ok);
  if (scalar.ok) assert.ok(scalar.keyframes.every((key) => typeof key.value === "number"));
  assert.equal(solveWiggle({ base: 50, amplitude: 5, frequency: 60, startTime: 0, duration: 86_400 }).ok, false);
  assert.equal(solveWiggle({ base: [1, 2], amplitude: [1, 2, 3], frequency: 2, startTime: 0, duration: 1 }).ok, false);
});

test("smooth keeps the endpoints and every key that strays past the tolerance", () => {
  const line = [0, 1, 2, 3, 4].map((time) => ({ time, value: time * 10 }));
  const flat = solveSmooth({ keyframes: line, tolerance: 0.5 });
  assert.ok(flat.ok);
  if (flat.ok) assert.deepEqual(flat.keyframes, [{ time: 0, value: 0 }, { time: 4, value: 40 }]);
  const bent = solveSmooth({ keyframes: [{ time: 0, value: 0 }, { time: 1, value: 10 }, { time: 2, value: 0 }], tolerance: 1 });
  assert.ok(bent.ok);
  if (bent.ok) assert.equal(bent.keyframes.length, 3);
  assert.equal(solveSmooth({ keyframes: [{ time: 0, value: 0 }, { time: 0, value: 1 }, { time: 2, value: 0 }], tolerance: 1 }).ok, false);
  assert.equal(solveSmooth({ keyframes: line, tolerance: 0 }).ok, false);
});

test("the tool returns set_layer_timing and animate_property plan operations", () => {
  const sequence = callTool("ae_solve_keyframe_assistant", { assistant: "sequence-layers", layers, startTime: 0, target: { compositionId: "comp-main" } }, {});
  assert.ok(sequence.ok);
  if (!sequence.ok) return;
  assert.deepEqual(operationsOf(JSON.stringify(sequence.data)).map(operationSummary), [["set_layer_timing", "a"], ["set_layer_timing", "b"], ["set_layer_timing", "c"]]);
  const wiggle = callTool("ae_solve_keyframe_assistant", { assistant: "wiggle", base: [0, 0], amplitude: 5, frequency: 2, startTime: 0, duration: 1, target: { compositionId: "comp-main", layerId: "a" }, propertyPath: "ADBE Transform Group/ADBE Position" }, {});
  assert.ok(wiggle.ok);
  if (wiggle.ok) assert.equal(operationsOf(JSON.stringify(wiggle.data)).map(operationSummary)[0]?.[0], "animate_property");
});

test("the tool names a bad assistant, a bad target, and a missing property path", () => {
  assert.equal(callTool("ae_solve_keyframe_assistant", { assistant: "bounce" }, {}).ok, false);
  assert.equal(callTool("ae_solve_keyframe_assistant", { assistant: "sequence-layers", layers, target: { layerId: "a" } }, {}).ok, false);
  assert.equal(callTool("ae_solve_keyframe_assistant", { assistant: "wiggle", base: 1, amplitude: 1, frequency: 1, startTime: 0, duration: 1, target: { compositionId: "c", layerId: "a" } }, {}).ok, false);
});

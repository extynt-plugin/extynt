/**
 * Apply-plan host contract: each write's own bounded read-back of what it left (mask and Essential Graphics counts,
 * enabled states, written file bytes, keyed shape paths, expression probes, vector group structure and long paths).
 */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { type RenderQueue, queuedItem, renderQueueOf } from "./host-apply-context.js";
import { FakeShapeRoot, loadApplyPlan, loadExtended, run } from "./host-apply-harness.js";
import { assertApplied } from "./host-plan-io.js";
import { evaluateJson } from "./host-vm-context.js";
import { type Found, fieldOf, recordAt, recordsAt } from "./json-narrow.js";
import { shapeReadbackMatches } from "./host-shape-readback.js";
import { type JsonObject, type JsonValue } from "@extynt/decode";

const target = { compositionId: "comp-main" };
const POSITION = "ADBE Transform Group/ADBE Position";
const SHAPE_PATH = "ADBE Root Vectors Group/ADBE Vector Shape - Group/ADBE Vector Shape";
const ZERO_TANGENT = [0, 0];
const RENDER_NOW: JsonValue = { operation: "render_composition", ...target, outputPath: "/renders/title.mov", destinationPolicy: "explicit-local-path", executeAuthorization: "RENDER_NOW" };

function zeroTangents(count: number): number[][] {
  return Array.from({ length: count }, () => [...ZERO_TANGENT]);
}

function positionKeys(): JsonValue {
  return { operation: "animate_property", ...target, layerId: "layer-title", propertyPath: POSITION, keyframes: [{ time: 0, value: [0, 0] }, { time: 2, value: [100, 0] }] };
}

function expressionOn(source: string): JsonValue {
  return { operation: "set_expression", ...target, layerId: "layer-title", propertyPath: POSITION, source, enabled: true };
}

test("remove_mask counts the parade either side of the removal", () => {
  const { apply } = loadApplyPlan();
  const result = run(apply, [
    { operation: "add_mask", ...target, layerId: "layer-shape", newMaskId: "__new__:m", name: "Reveal", values: { opacity: 50 } },
    { operation: "remove_mask", ...target, layerId: "layer-shape", maskId: "__new__:m", destructive: true },
  ]);
  assertApplied(result);
  assert.deepEqual([fieldOf(result, "steps", 1, "maskCountBefore"), fieldOf(result, "steps", 1, "maskCountAfter")], [2, 1]);
});

test("set_time_remap and ensure_effect read the state they wrote back from the layer and the effect", () => {
  const { apply } = loadApplyPlan();
  const result = run(apply, [
    { operation: "set_time_remap", ...target, layerId: "layer-title", enabled: true },
    { operation: "ensure_effect", ...target, layerId: "layer-title", capabilityId: "adobe.gaussian-blur", effectMatchName: "ADBE Gaussian Blur 2", effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2", enabled: false },
  ]);
  assertApplied(result);
  assert.equal(fieldOf(result, "steps", 0, "observedEnabled"), true);
  assert.equal(fieldOf(result, "steps", 1, "observedEnabled"), false);
});

test("add_essential_property reads the controller list either side of the add, and sends nothing on a host without the getters", () => {
  const { apply, comp, title } = loadExtended();
  const transform = title.properties.find((property) => property.matchName === "ADBE Transform Group");
  const position = transform?.children[0];
  assert.ok(position);
  const names = ["Size"];
  position.addToMotionGraphicsTemplateAs = (_target, name) => {
    names.push(name);
    return true;
  };
  const operation: JsonValue = { operation: "add_essential_property", ...target, layerId: "layer-title", propertyPath: POSITION, name: "Title Position" };
  const without = run(apply, [operation]);
  assertApplied(without);
  assert.equal(fieldOf(without, "steps", 0, "essential"), null, "no getter, no claim");
  const nameAt = (index: number): string => {
    const name = names[index - 1];
    if (name === undefined) throw new Error("out of range");
    return name;
  };
  Object.defineProperty(comp, "motionGraphicsTemplateControllerCount", { get: () => names.length });
  comp.getMotionGraphicsTemplateControllerName = nameAt;
  const withGetters = run(apply, [operation]);
  assert.deepEqual(fieldOf(withGetters, "steps", 0, "essential"), { before: 2, after: 3, names: ["Size", "Title Position", "Title Position"] });
  assert.equal(fieldOf(withGetters, "steps", 0, "named"), true);
});

function emptyOutputAfterRender(queue: RenderQueue): void {
  const original = queue.render.bind(queue);
  queue.render = () => {
    original();
    for (let index = 1; index <= queue.items.length; index += 1) {
      const file = queuedItem(queue, index).outputModule().file;
      if (file) file.length = 0;
    }
  };
}

test("a render reports the written file's bytes, and an empty output file fails the step", () => {
  const { apply, context } = loadApplyPlan();
  const written = run(apply, [RENDER_NOW]);
  assert.equal(fieldOf(written, "steps", 0, "bytes"), 4096);
  emptyOutputAfterRender(renderQueueOf(context));
  const empty = run(apply, [RENDER_NOW]);
  assert.equal(fieldOf(empty, "ok"), false);
  assert.match(String(fieldOf(empty, "error", "message")), /RENDER_EXECUTION_FAILED/);
});

test("a shape-path animation reads each key's full path back at its key time", () => {
  const { apply } = loadApplyPlan();
  const keyframes: ReadonlyArray<JsonValue> = [{ time: 0, value: { vertices: [[0, 0], [1, 0], [1, 1]], closed: true } }, { time: 1, value: { vertices: [[0, 0], [2, 0], [2, 2]], closed: false } }];
  const result = run(apply, [{ operation: "animate_property", ...target, layerId: "layer-shape", propertyPath: SHAPE_PATH, keyframes }]);
  assertApplied(result);
  const zeros = zeroTangents(3);
  assert.deepEqual(fieldOf(result, "steps", 0, "shapeKeyValues"), [
    { time: 0, value: { vertices: [[0, 0], [1, 0], [1, 1]], inTangents: zeros, outTangents: zeros, closed: true } },
    { time: 1, value: { vertices: [[0, 0], [2, 0], [2, 2]], inTangents: zeros, outTangents: zeros, closed: false } },
  ]);
});

function isProbeSample(sample: JsonObject): boolean {
  return typeof fieldOf(sample, "time") === "number" && Array.isArray(fieldOf(sample, "value")) && Array.isArray(fieldOf(sample, "base"));
}

test("set_expression probes a wiggle around its pre-expression value and a loopOut past its last key, and nothing else", () => {
  const { apply } = loadApplyPlan();
  const samples = recordsAt(run(apply, [expressionOn("wiggle(2, 10)")]), "steps", 0, "expressionProbe", "wiggle");
  assert.ok(samples.length >= 2 && samples.length <= 8);
  assert.ok(samples.every(isProbeSample));
  const looped = run(apply, [positionKeys(), expressionOn('loopOut("cycle")')]);
  assertApplied(looped);
  const loop = recordAt(looped, "steps", 1, "expressionProbe", "loop");
  assert.deepEqual([fieldOf(loop, "firstKey"), fieldOf(loop, "lastKey")], [0, 2]);
  assert.deepEqual(recordsAt(loop, "points").map((point) => fieldOf(point, "offset")), [0.5, 1, 1.5]);
  const pinged = run(loadApplyPlan().apply, [positionKeys(), expressionOn('loopOut("pingpong")')]);
  assertApplied(pinged);
  const mirrored = recordAt(pinged, "steps", 1, "expressionProbe", "loop");
  assert.deepEqual([fieldOf(mirrored, "firstKey"), fieldOf(mirrored, "lastKey")], [0, 2]);
  assert.equal(fieldOf(run(apply, [expressionOn("value + [0, 10]")]), "steps", 0, "expressionProbe"), undefined);
});

test("draw_vector_shapes reads each group's paths whole, its ordered contents, its transform and the layer bounds", () => {
  const harness = loadApplyPlan();
  const sourceRect = (_time: number, extents: boolean): JsonObject => ({ left: 10, top: 20, width: extents ? 999 : 100, height: 50 });
  Object.assign(harness.shapeLayer, { sourceRectAtTime: sourceRect });
  const triangle = { name: "Tri", paths: [{ vertices: [[10, 20], [110, 20], [110, 70]], closed: true }], stroke: { color: [0, 0, 0], width: 2 }, fill: { color: [1, 0, 0] }, opacity: 60 };
  const operation: JsonObject = { operation: "draw_vector_shapes", ...target, layerId: "layer-shape", shapes: [triangle] };
  const result = run(harness.apply, [operation]);
  assertApplied(result);
  const readback = recordAt(result, "steps", 0, "readback");
  assert.deepEqual(fieldOf(readback, "bounds"), { left: 10, top: 20, width: 100, height: 50 }, "bounds without stroke extents");
  const group = recordsAt(readback, "groups")[0];
  assert.deepEqual(fieldOf(group, "pathValues"), [{ vertices: [[10, 20], [110, 20], [110, 70]], inTangents: zeroTangents(3), outTangents: zeroTangents(3), closed: true }]);
  assert.deepEqual(recordsAt(group, "contents", "children").map((child) => fieldOf(child, "matchName")), ["ADBE Vector Shape - Group", "ADBE Vector Graphic - Stroke", "ADBE Vector Graphic - Fill"]);
  assert.equal(fieldOf(group, "transform", "opacity"), 60);
  const root = harness.shapeLayer.properties.find((property) => property.matchName === "ADBE Root Vectors Group");
  assert.ok(root instanceof FakeShapeRoot);
  assert.equal(fieldOf(readback, "existing"), root.children.length - 1);
  assert.equal(shapeReadbackMatches("draw_vector_shapes", operation, readback), true, "the panel accepts the host's read of its own write");
});

function boundedPath(context: vm.Context, path: JsonValue, budget: JsonValue): Found {
  Object.assign(context, { pathArgument: path, budgetArgument: budget });
  return evaluateJson(context, "aeApplyBoundedPath(pathArgument, budgetArgument)");
}

function vertexDigest(vertices: ReadonlyArray<ReadonlyArray<number>>): number {
  let digest = 0;
  for (const [x = 0, y = 0] of vertices) digest += x + 2 * y;
  return digest;
}

test("a path past 256 vertices comes back as its count, digest and first and last eight points", () => {
  const { context } = loadApplyPlan();
  const vertices = Array.from({ length: 300 }, (_, index) => [index, 2 * index]);
  const zeros = zeroTangents(300);
  const summary = boundedPath(context, { vertices, inTangents: zeros, outTangents: zeros, closed: false }, null);
  assert.deepEqual([fieldOf(summary, "count"), fieldOf(summary, "closed"), fieldOf(summary, "digest")], [300, false, vertexDigest(vertices)]);
  assert.deepEqual(fieldOf(summary, "head", "vertices"), vertices.slice(0, 8));
  assert.deepEqual(fieldOf(summary, "tail", "vertices"), vertices.slice(292));
  const short = { vertices: vertices.slice(0, 3), inTangents: zeroTangents(3), outTangents: zeroTangents(3), closed: true };
  assert.equal(fieldOf(boundedPath(context, short, { points: 2 }), "count"), 3, "a short path past the shared budget is summarised too");
  const ragged = { vertices: [[0, 0]], inTangents: [[0, 0], [0, 0]], outTangents: [[0, 0]], closed: true };
  assert.equal(boundedPath(context, ragged, null), null, "ragged arrays are no read");
});

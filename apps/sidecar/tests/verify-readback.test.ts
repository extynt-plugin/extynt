/** Verdicts from each operation's own targeted host read: counts, enabled states, written files, spec values and keys,
 * expression probes, keyed shape values, full paths, group structure and rendered bounds. */
import type { JsonObject, JsonValue } from "@extynt/decode";
import assert from "node:assert/strict";
import test from "node:test";
import { decodeOrThrow } from "@extynt/decode";
import { hostStepOf } from "../src/verify/host-step.js";
import { requestOf } from "../src/verify/plan-request.js";
import { expressionProbe, expressionProbeResult } from "../src/verify/expression-probe.js";
import { shapeKeyValueMismatch } from "../src/verify/shape-keys.js";
import { pathMismatchField, shapePathDecoder } from "../src/verify/shape-path.js";
import { shapeReadbackMatches } from "../src/verify/shape-readback.js";
import type { VerifiedStep } from "../src/verify/verdicts.js";
import { LAYER, PROPERTY_PATH, verdict } from "./verify-fixtures.js";
import { entry, makeLayer, type Row } from "./native-fixtures.js";

const states = (row: VerifiedStep): [string | undefined, string | undefined] => [String(row.verificationState), String(row.basis)];

test("remove_mask is exact only when the host counted exactly one fewer mask", () => {
  const removal = (step: Row) => verdict({ operations: [{ operation: "remove_mask", maskId: "m1" }], hostSteps: [{ operation: "remove_mask", ...step }] });
  assert.deepEqual(states(removal({ maskCountBefore: 3, maskCountAfter: 2 })), ["exact", "mask-absent-host-readback"]);
  assert.deepEqual(states(removal({ maskCountBefore: 3, maskCountAfter: 3 })), ["failed", "mask-count-mismatch"]);
  assert.deepEqual(states(removal({})), ["applied_unverified", "mask-count-not-read"], "a host that did not count proves nothing");
});

test("set_time_remap compares the layer's own timeRemapEnabled read with the request", () => {
  const remap = (enabled: boolean, observedEnabled?: JsonValue) => verdict({ operations: [{ operation: "set_time_remap", enabled }], hostSteps: [{ operation: "set_time_remap", observedEnabled }] });
  assert.deepEqual(states(remap(true, true)), ["exact", "time-remap-host-readback"]);
  assert.deepEqual(states(remap(false, false)), ["exact", "time-remap-host-readback"]);
  assert.deepEqual(states(remap(true, false)), ["failed", "time-remap-state-mismatch"]);
  assert.deepEqual(states(remap(true, "yes")), ["applied_unverified", "time-remap-state-not-read"]);
});

test("add_essential_property needs one more controller, under the requested name when one was set", () => {
  const add = (step: Row, name?: string) => verdict({ operations: [{ operation: "add_essential_property", propertyPath: PROPERTY_PATH, ...(name ? { name } : {}) }], hostSteps: [{ operation: "add_essential_property", ...step }] });
  assert.deepEqual(states(add({ essential: { before: 1, after: 2, names: ["Size", "Title"] }, named: true }, "Title")), ["exact", "essential-graphics-host-readback"]);
  assert.deepEqual(states(add({ essential: { before: 1, after: 2, names: ["Size", "Position"] } })), ["exact", "essential-graphics-host-readback"], "an unnamed add only needs the count");
  assert.deepEqual(states(add({ essential: { before: 1, after: 1, names: ["Size"] } })), ["failed", "essential-controller-count-mismatch"]);
  assert.deepEqual(states(add({ essential: { before: 1, after: 2, names: ["Size", "Position"] }, named: true }, "Title")), ["failed", "essential-controller-name-missing"]);
  assert.deepEqual(states(add({ essential: null })), ["applied_unverified", "essential-graphics-not-readable"], "a host without the controller getters keeps the old unverified verdict");
});

test("a render or MOGRT export is exact when the written file holds bytes, and fails when it is empty", () => {
  const render = (bytes: number) => verdict({ operations: [{ operation: "render_composition" }], hostSteps: [{ operation: "render_composition", verification: "render-file-written", file: "/tmp/out.mov", bytes }] });
  assert.deepEqual(states(render(4096)), ["exact", "render-file-written"]);
  assert.deepEqual(states(render(0)), ["failed", "written-file-empty"]);
  const mogrt = (bytes: number) => verdict({ operations: [{ operation: "export_mogrt" }], hostSteps: [{ operation: "export_mogrt", verification: "mogrt-file-written", file: "/tmp/out.mogrt", bytes }] });
  assert.deepEqual(states(mogrt(12)), ["exact", "mogrt-file-written"]);
  assert.deepEqual(states(mogrt(0)), ["failed", "written-file-empty"]);
});

test("a written MOGRT or frame export verifies when the post-apply snapshot lacks the composition, and stays failed when the file is empty or absent", () => {
  const exported = (operation: string, verification: string, step: Row) => verdict({ operations: [{ operation, compositionId: "73" }], hostSteps: [{ operation, compositionId: "73", ...step, verification }], comp: { id: "other" } });
  const mogrt = (step: Row) => exported("export_mogrt", "mogrt-file-written", step);
  assert.deepEqual(states(mogrt({ file: "C:/out.mogrt", bytes: 2048 })), ["exact", "mogrt-file-written"]);
  assert.equal(mogrt({ file: "C:/out.mogrt", bytes: 2048 }).compositionId, "73");
  assert.deepEqual(states(mogrt({ file: "C:/out.mogrt", bytes: 0 })), ["failed", "written-file-empty"]);
  assert.deepEqual(states(mogrt({})), ["failed", "composition-missing"], "no written-file evidence keeps the composition-missing failure");
  assert.deepEqual(states(exported("export_frame", "frame-file-written", { file: "C:/f.png", bytes: 99 })), ["exact", "frame-file-written"]);
});

test("ensure_effect falls back to the host's enabled read when the snapshot row carries none", () => {
  const ensure = (observedEnabled: JsonValue) => verdict({ operations: [{ operation: "ensure_effect", effectPath: PROPERTY_PATH, enabled: false }], hostSteps: [{ operation: "ensure_effect", observedEnabled }] });
  assert.deepEqual(states(ensure(false)), ["exact", "effect-enabled-host-readback"]);
  assert.deepEqual(states(ensure(true)), ["failed", "effect-enabled-mismatch"]);
  assert.deepEqual(states(ensure(null)), ["applied_unverified", "effect-enabled-state-not-in-snapshot"]);
});

test("ensure_layer_style falls back to the host's enabled and value reads when the snapshot lacks the style", () => {
  const style = (step: Row) => verdict({ operations: [{ operation: "ensure_layer_style", style: "dropShadow", styleMatchName: "dropShadow/enabled", enabled: true, values: { "dropShadow/opacity": 50 } }], hostSteps: [{ operation: "ensure_layer_style", ...step }] });
  assert.deepEqual(states(style({ enabled: true, values: { "dropShadow/opacity": 50 } })), ["exact", "layer-style-enabled-and-values"]);
  assert.deepEqual(states(style({ enabled: true, values: { "dropShadow/opacity": 75 } })), ["failed", "layer-style-value-mismatch"]);
  assert.deepEqual(states(style({ enabled: false })), ["failed", "layer-style-enabled-mismatch"]);
  assert.deepEqual(states(style({})), ["applied_unverified", "layer-style-state-not-in-snapshot"]);
});

test("structured specs fail on a host value or key read that disagrees with the request, and pass on one that agrees", () => {
  const path = "ADBE Root Vectors Group/ADBE Vector Group/ADBE Vector Transform Group/ADBE Vector Rotation";
  const operation = { operation: "add_shape_item", writes: [{ path, value: 45 }], animations: [{ path, keyframes: [{ time: 0, value: 0 }, { time: 1, value: 90 }] }] };
  const keys = (second: number) => ({ count: 2, keys: [{ time: 0, value: 0 }, { time: 1, value: second }], truncated: false });
  const container = "ADBE Root Vectors Group/ADBE Vector Group", layer = makeLayer(LAYER, 1, { propertyPaths: [entry(container, {})] });
  const run = (written: number, second: number) => verdict({ operations: [operation], hostSteps: [{ operation: "add_shape_item", containerPath: container, writes: [{ path, value: written }], animations: [{ path, afterKeys: 2, keys: keys(second) }] }], layers: [layer] });
  assert.equal(run(45, 90).verificationState, "exact", "specs the snapshot does not carry pass on the host's matching reads");
  assert.deepEqual(states(run(30, 90)), ["failed", "spec-host-readback-mismatch"]);
  assert.deepEqual(states(run(45, 80)), ["failed", "spec-host-readback-mismatch"]);
});

const probeOf = (value: JsonObject) => decodeOrThrow(expressionProbe, value);
const detailless = (source: string, probe: JsonObject) => expressionProbeResult("set_expression", source, probeOf(probe), {});

test("wiggle and loopOut probes verify the motion they promise, and leave other sources to the sampled motion", () => {
  const wiggle = (values: number[]) => detailless("wiggle(2, 10)", { wiggle: values.map((value, index) => ({ time: index, value: [100 + value, 50], base: [100, 50] })) });
  assert.equal(wiggle([3, -8, 10.4])?.basis, "property-expression-wiggle-bounds");
  assert.deepEqual([wiggle([3, -25])?.verificationState, wiggle([3, -25])?.basis], ["failed", "expression-motion-mismatch"]);
  assert.equal(wiggle([0, 0])?.verificationState, "failed");
  assert.equal(detailless('wiggle(2, effect("Amp")(1))', { wiggle: [] }), null);
});

test("loopOut probes verify cycle and pingpong motion against the keyed values", () => {
  const loop = (source: string, looped: number) => detailless(source, { loop: { firstKey: 0, lastKey: 2, points: [{ offset: 0.5, looped: 25, keyed: 25 }, { offset: 1, looped, keyed: 50 }] } });
  assert.equal(loop('loopOut("cycle")', 50)?.basis, "property-expression-loop-cycle");
  assert.equal(loop("loopOut()", 50)?.verificationState, "exact");
  assert.equal(loop("loopOut()", 40)?.verificationState, "failed");
  const pingpong = (source: string, looped: number) => detailless(source, { loop: { firstKey: 0, lastKey: 2, points: [{ offset: 0.5, looped: 75, keyed: 75 }, { offset: 1, looped, keyed: 50 }] } });
  assert.equal(pingpong('loopOut("pingpong")', 50)?.basis, "property-expression-loop-pingpong");
  assert.equal(pingpong("loopOut('pingpong', 0)", 40)?.verificationState, "failed");
  assert.equal(loop('loopOut("continue")', 40), null);
});

test("a keyed shape path read back at its key time is compared vertex by vertex", () => {
  const request = requestOf({ operation: "animate_property", keyframes: [{ time: 1, value: { vertices: [[0, 0], [10, 0], [10, 10]], closed: true } }] });
  const read = (vertices: number[][], closed = true) => hostStepOf({ operation: "animate_property", shapeKeyValues: [{ time: 1, value: { vertices, inTangents: [[0, 0], [0, 0], [0, 0]], outTangents: [[0, 0], [0, 0], [0, 0]], closed } }] });
  assert.equal(shapeKeyValueMismatch(read([[0, 0], [10.0001, 0], [10, 10]]), request), null);
  assert.deepEqual(shapeKeyValueMismatch(read([[0, 0], [11, 0], [10, 10]]), request), { time: 1, field: "vertices" });
  assert.deepEqual(shapeKeyValueMismatch(read([[0, 0], [10, 0], [10, 10]], false), request), { time: 1, field: "closed" });
});

test("a key row that is not an object keeps its place, so the value read at the next key is still compared with that key", () => {
  const triangle = { vertices: [[0, 0], [10, 0], [10, 10]], closed: true };
  const request = requestOf({ operation: "animate_property", keyframes: ["broken", { time: 1, value: triangle }] });
  const flat = [[0, 0], [0, 0], [0, 0]];
  const read = (vertices: number[][]) => hostStepOf({ operation: "animate_property", shapeKeyValues: [{ time: 0, value: triangle }, { time: 1, value: { vertices, inTangents: flat, outTangents: flat, closed: true } }] });
  assert.equal(shapeKeyValueMismatch(read([[0, 0], [10, 0], [10, 10]]), request), null);
  assert.deepEqual(shapeKeyValueMismatch(read([[0, 0], [11, 0], [10, 10]]), request), { time: 1, field: "vertices" });
});

test("a path past the host's whole-read limit is compared by count, digest and its first and last points", () => {
  const vertices = Array.from({ length: 300 }, (_, index) => [index, index * 2]);
  const zeros = vertices.map(() => [0, 0]);
  const digest = vertices.reduce((sum, vertex) => sum + (vertex[0] ?? 0) + 2 * (vertex[1] ?? 0), 0);
  const summary = (overrides: JsonObject = {}): JsonObject => ({ count: 300, closed: false, digest, head: { vertices: vertices.slice(0, 8), inTangents: zeros.slice(0, 8), outTangents: zeros.slice(0, 8) }, tail: { vertices: vertices.slice(292), inTangents: zeros.slice(292), outTangents: zeros.slice(292) }, ...overrides });
  const path = decodeOrThrow(shapePathDecoder, { vertices, closed: false });
  assert.equal(pathMismatchField(summary(), path), null);
  assert.equal(pathMismatchField(summary({ count: 299 }), path), "count");
  assert.equal(pathMismatchField(summary({ digest: digest + 50 }), path), "digest");
  assert.equal(pathMismatchField(summary({ closed: true }), path), "closed");
  assert.equal(pathMismatchField({ vertices: vertices.slice(0, 3), inTangents: zeros.slice(0, 3), outTangents: zeros.slice(0, 3), closed: false }, path), "vertices");
});

const zeros = [[0, 0], [0, 0], [0, 0]];
const paths = [{ vertices: [[10, 20], [110, 20], [110, 70]], closed: true }];
const triangle = requestOf({ operation: "draw_vector_shapes", shapes: [{ name: "Tri", paths, fill: { color: [1, 0, 0] }, stroke: { color: [0, 0, 0], width: 2 } }] });

function group(extra: JsonObject = {}): JsonObject {
  const children = [{ matchName: "ADBE Vector Shape - Group" }, { matchName: "ADBE Vector Graphic - Stroke" }, { matchName: "ADBE Vector Graphic - Fill" }];
  return {
    matchName: "ADBE Vector Group",
    name: "Tri",
    paths: 1,
    points: 3,
    closedPaths: 1,
    checksum: 10 + 40 + 110 + 40 + 110 + 140,
    fill: { matchName: "ADBE Vector Graphic - Fill", color: [1, 0, 0, 1] },
    stroke: { matchName: "ADBE Vector Graphic - Stroke", color: [0, 0, 0, 1], width: 2 },
    opacity: 100,
    pathValues: [{ ...paths[0], inTangents: zeros, outTangents: zeros }],
    contents: { count: 3, children },
    transform: { anchor: [0, 0], position: [0, 0], scale: [100, 100], rotation: 0, opacity: 100 },
    ...extra,
  };
}

function readback(groupExtra: JsonObject = {}, extra: JsonObject = {}): JsonObject {
  return { matchName: "ADBE Root Vectors Group", existing: 0, groups: [group(groupExtra)], bounds: { left: 10, top: 20, width: 100, height: 50 }, ...extra };
}

const drawn = (read: JsonObject) => shapeReadbackMatches("draw_vector_shapes", triangle, read);

test("draw_vector_shapes checks each path whole, the stroke-over-fill order, the group transform and unambiguous bounds", () => {
  const children = (...names: string[]): JsonObject => ({ count: 3, children: names.map((matchName) => ({ matchName })) });
  assert.equal(drawn(readback()), true);
  assert.equal(drawn(readback({ pathValues: [{ ...paths[0], vertices: [[10, 20], [110, 20], [110, 71]], inTangents: zeros, outTangents: zeros }] })), false);
  assert.equal(drawn(readback({ contents: children("ADBE Vector Shape - Group", "ADBE Vector Graphic - Fill", "ADBE Vector Graphic - Stroke") })), false);
  assert.equal(drawn(readback({ transform: { anchor: [0, 0], position: [5, 0], scale: [100, 100], rotation: 0, opacity: 100 } })), false);
  assert.equal(drawn(readback({}, { bounds: { left: 10, top: 20, width: 140, height: 50 } })), false);
  assert.equal(drawn(readback({}, { existing: 2, bounds: { left: 0, top: 0, width: 500, height: 500 } })), true);
  const { pathValues, contents, transform, ...older } = group();
  assert.equal(drawn(readback({}, { groups: [older] })), true);
  assert.equal([pathValues, contents, transform].length, 3);
});

test("create_shape_group requires an empty group with the default transform when the host reads them", () => {
  const read = (extra: JsonObject = {}): JsonObject => ({ matchName: "ADBE Vector Group", name: "G", ordinal: 1, contents: { count: 0, children: [] }, transform: { anchor: [0, 0], position: [0, 0], scale: [100, 100], rotation: 0, opacity: 100 }, ...extra });
  const request = requestOf({ operation: "create_shape_group", name: "G" });
  assert.equal(shapeReadbackMatches("create_shape_group", request, read()), true);
  assert.equal(shapeReadbackMatches("create_shape_group", request, read({ contents: { count: 1, children: [{ matchName: "ADBE Vector Shape - Group" }] } })), false);
  assert.equal(shapeReadbackMatches("create_shape_group", request, read({ transform: { scale: [50, 50] } })), false);
});

test("the shape readback reaches the receipt with its rendered bounds as evidence", () => {
  const path = { vertices: [[0, 0], [100, 0], [100, 100]], closed: true };
  const layer = makeLayer(LAYER, 1, { propertyPaths: [entry(PROPERTY_PATH, {})] });
  const read = { matchName: "ADBE Vector Shape", ...path, inTangents: zeros, outTangents: zeros, bounds: { left: 0, top: 0, width: 100, height: 100 } };
  const result = verdict({ operations: [{ operation: "set_shape_path", path }], hostSteps: [{ operation: "set_shape_path", readback: read }], layers: [layer] });
  assert.deepEqual(states(result), ["exact", "shape-host-readback"]);
  assert.deepEqual(result.renderedBounds, { left: 0, top: 0, width: 100, height: 100 });
});

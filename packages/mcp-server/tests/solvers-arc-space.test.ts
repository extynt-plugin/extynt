// Tests for carrying an arc into a parented layer's space: keys and handles land back on the composition-space path, and Rotation faces along it on screen.
import test from "node:test";
import assert from "node:assert/strict";
import { array, decodeOrThrow, number, object, string } from "@extynt/decode";
import { arcInParentSpace } from "../src/solvers/arc-space.js";
import { parentSpaceOf } from "../src/solvers/geometry.js";
import { applyLinear, applyMatrix } from "../src/solvers/matrix.js";
import type { Matrix2D } from "../src/solvers/matrix.js";
import type { ArcPathInput, ArcPathResult } from "../src/solvers/path.js";
import type { SolvedKeyframe, Vec2 } from "../src/solvers/types.js";
import { callTool } from "../src/index.js";
import { keyframeAt, numberOf, pointOf, solvedArc } from "./solvers-arc-fixtures.js";
import { makeLayer, sceneSnapshot, standardProperties } from "./solvers-fixtures.js";
import type { TransformValues } from "./solvers-fixtures.js";
import { payloadOf } from "./support/json-results.js";

const ARC: ArcPathInput = { center: [960, 540], radius: 300, radiusY: 120, axisRotation: 20, startAngle: 10, sweep: 300, startTime: 0, duration: 3, segments: 10, orient: { forwardAngle: 0 } };

function sceneWithParents(parents: ReadonlyArray<TransformValues>): ReturnType<typeof sceneSnapshot> {
  const chain = parents.map((values, index) => makeLayer(`parent${index}`, `Parent ${index}`, standardProperties(values), index + 1 < parents.length ? { parentId: `parent${index + 1}` } : {}));
  const child = makeLayer("child", "Child", standardProperties(), parents.length ? { parentId: "parent0" } : {});
  return sceneSnapshot({ layers: [...chain, child] });
}

function toCompOf(parents: ReadonlyArray<TransformValues>): Matrix2D {
  const space = parentSpaceOf(sceneWithParents(parents), "comp1", "child");
  assert.ok(!("ok" in space));
  return space.toComp;
}

function near(actual: Vec2, expected: Vec2, tolerance: number, label: string): void {
  assert.ok(Math.hypot(actual[0] - expected[0], actual[1] - expected[1]) <= tolerance, `${label}: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`);
}

function directionAngle(vector: Vec2): number {
  return Math.atan2(vector[1], vector[0]);
}

function travel(keyframe: SolvedKeyframe): Vec2 {
  const spatial = keyframe.spatial;
  assert.ok(spatial);
  const [x, y] = spatial.outTangent;
  return x !== 0 || y !== 0 ? spatial.outTangent : [-spatial.inTangent[0], -spatial.inTangent[1]];
}

function handlesOf(keyframe: SolvedKeyframe): readonly [Vec2, Vec2] {
  assert.ok(keyframe.spatial);
  return [keyframe.spatial.inTangent, keyframe.spatial.outTangent];
}

function assertSamePathOnScreen(comp: ArcPathResult, parent: ArcPathResult, toComp: Matrix2D): void {
  comp.position.keyframes.forEach((keyframe, index) => {
    const mapped = keyframeAt(parent.position.keyframes, index);
    near(applyMatrix(toComp, pointOf(mapped)), pointOf(keyframe), 0.02, `key ${index}`);
    const [mappedIn, mappedOut] = handlesOf(mapped);
    const [compIn, compOut] = handlesOf(keyframe);
    near(applyLinear(toComp, mappedIn), compIn, 0.02, `in handle ${index}`);
    near(applyLinear(toComp, mappedOut), compOut, 0.02, `out handle ${index}`);
  });
}

function assertFacesTravelOnScreen(comp: ArcPathResult, parent: ArcPathResult, toComp: Matrix2D): void {
  assert.ok(parent.rotation);
  parent.rotation.keyframes.forEach((keyframe, index) => {
    const radians = (numberOf(keyframe) * Math.PI) / 180;
    const forwardOnScreen = applyLinear(toComp, [Math.cos(radians), Math.sin(radians)]);
    const wanted = directionAngle(travel(keyframeAt(comp.position.keyframes, index)));
    const difference = Math.abs(Math.atan2(Math.sin(directionAngle(forwardOnScreen) - wanted), Math.cos(directionAngle(forwardOnScreen) - wanted)));
    assert.ok(difference < 1e-3, `key ${index} faces ${(difference * 180) / Math.PI} degrees off its path`);
  });
}

const PARENTS: ReadonlyArray<{ readonly label: string; readonly chain: ReadonlyArray<TransformValues>; readonly caveat: RegExp | null }> = [
  { label: "rotated and scaled", chain: [{ position: [400, 300], anchor: [50, 20], rotation: 35, scale: [80, 80] }], caveat: null },
  { label: "mirrored", chain: [{ position: [960, 540], scale: [-100, 100] }], caveat: null },
  { label: "non-uniform", chain: [{ position: [100, 100], scale: [200, 50], rotation: -15 }], caveat: /not uniform/ },
  { label: "nested", chain: [{ position: [50, 60], rotation: 90 }, { position: [700, 200], rotation: -30, scale: [150, 150] }], caveat: null },
];

for (const { label, chain, caveat } of PARENTS) {
  test(`Parent space (${label}): the keys trace the same path on screen and Rotation faces along it`, () => {
    const comp = solvedArc(ARC);
    const toComp = toCompOf(chain);
    const { result, caveats } = arcInParentSpace(comp, toComp);
    assertSamePathOnScreen(comp, result, toComp);
    assertFacesTravelOnScreen(comp, result, toComp);
    if (caveat) assert.match(caveats.join(" "), caveat);
    else assert.deepEqual(caveats, []);
  });
}

test("Parent space: a full turn under a mirrored parent turns the other way", () => {
  const comp = solvedArc({ ...ARC, radiusY: 300, axisRotation: 0, sweep: 360, segments: 8 });
  const { result } = arcInParentSpace(comp, toCompOf([{ scale: [-100, 100] }]));
  assert.ok(result.rotation);
  const rotations = result.rotation.keyframes.map(numberOf);
  assert.equal(Math.round((rotations.at(-1) ?? 0) - (rotations[0] ?? 0)), -360);
});

test("Parent space: an unparented layer keeps the composition-space answer exactly", () => {
  const comp = solvedArc(ARC);
  assert.deepEqual(arcInParentSpace(comp, toCompOf([])), { result: comp, caveats: [] });
});

test("Parent space: a zero-scale parent leaves the keys in composition pixels and says so", () => {
  const comp = solvedArc(ARC);
  const { result, caveats } = arcInParentSpace(comp, toCompOf([{ scale: [0, 100] }]));
  assert.deepEqual(result, comp);
  assert.match(caveats.join(" "), /scale is zero/);
});

const placedView = object({
  parentSpace: object({ parentChain: array(string()), caveats: array(string()) }),
  operations: array(object({ type: string() })),
  next: string(),
});

test("ae_solve_arc_path with a target converts into the target's parent space from the snapshot", () => {
  const snapshot = sceneWithParents([{ position: [500, 500], rotation: 90 }]);
  const args = { center: [500, 600], radius: 100, startAngle: 0, sweep: 90, startTime: 0, duration: 1, segments: 1, target: { compositionId: "comp1", layerId: "child" } };
  const payload = payloadOf(callTool("ae_solve_arc_path", args, { snapshot }));
  const data = decodeOrThrow(placedView, payload);
  assert.deepEqual(data.parentSpace.parentChain, ["parent0"]);
  assert.match(data.next, /already in the layer's parent space/);
  const keys = decodeOrThrow(object({ position: object({ keyframes: array(object({ value: array(number()) })) }) }), payload);
  assert.deepEqual(keys.position.keyframes.map((keyframe) => keyframe.value), [[100, -100], [200, 0]]);
});

test("ae_solve_arc_path with a target it cannot find in the snapshot leaves the keys unconverted and says why", () => {
  const args = { center: [0, 0], radius: 100, startAngle: 0, sweep: 90, startTime: 0, duration: 1, target: { compositionId: "comp1", layerId: "__new__:dot" } };
  const data = decodeOrThrow(placedView, payloadOf(callTool("ae_solve_arc_path", args, { snapshot: sceneWithParents([]) })));
  assert.match(data.parentSpace.caveats.join(" "), /not in composition comp1.*composition pixels/);
});


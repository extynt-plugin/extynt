// Orbit coverage: a layer must travel around something, not spin in place, before an orbit request is covered.
import test from "node:test";
import assert from "node:assert/strict";
import type { PropertySnapshot } from "@extynt/project-graph";
import { type JsonValue } from "@extynt/decode";
import { missingFeatures, requestedFeatures } from "../src/request-coverage.js";
import { key, layer, property, snapshotOf, step } from "./coverage-fixtures.js";

const TRANSFORM = "ADBE Transform Group/";
const GOAL = "A rocket orbiting a ringed planet, nose-first.";
const CIRCLE = [[0, -400], [400, 0], [0, 400], [-400, 0]].map((offset, index) => key(index, [810 + (offset[0] ?? 0), 730 + (offset[1] ?? 0)]));
const orbitMissing = (snapshot: ReturnType<typeof snapshotOf>, applied: ReturnType<typeof step>[] = []) => missingFeatures(GOAL, snapshot, applied).filter((label) => /^orbit motion/.test(label));
const spin = (extra: Partial<PropertySnapshot> = {}) => property(`${TRANSFORM}ADBE Rotate Z`, { keyframes: [key(0, 0), key(6, 360)], keyframeCount: 2, ...extra });
const at = (x: number, y: number) => property(`${TRANSFORM}ADBE Position`, { valueType: "vector", value: [x, y] });
const rocketWith = (...properties: PropertySnapshot[]) => snapshotOf([layer("rocket", { properties })]);
const positionKeyed = (keys: ReturnType<typeof key>[]) => rocketWith(property(`${TRANSFORM}ADBE Position`, { valueType: "vector", keyframes: keys, keyframeCount: keys.length }));

const evidenceRig = (holderChildAt: [number, number], rotatingId: "holder" | "path") => snapshotOf([
  layer("path", { type: "null", properties: [at(810, 730), ...(rotatingId === "path" ? [spin()] : [])] }),
  layer("holder", { type: "null", parentId: "path", properties: [at(0, -400), ...(rotatingId === "holder" ? [spin()] : [])] }),
  layer("rocket", { parentId: "holder", properties: [at(...holderChildAt)] }),
]);

test("orbit is requested by orbit, circle-around and revolve-around wording, not by negation or absence", () => {
  const orbit = (goal: string) => requestedFeatures(goal).map((feature) => feature.id).filter((id) => id === "orbit");
  for (const goal of ["a rocket orbiting a planet", "Moons orbit the planet.", "circle around the logo", "it revolves around the sun", "the orbit of the moon"]) assert.deepEqual(orbit(goal), ["orbit"], goal);
  for (const goal of ["a rocket flying past a planet", "No orbit, just a straight flight.", "without an orbit"]) assert.deepEqual(orbit(goal), [], goal);
});

test("rotation on a holder whose child sits on its anchor only spins in place, so orbit is missing", () => {
  const missing = orbitMissing(evidenceRig([-1, -2], "holder"));
  assert.equal(missing.length, 1, JSON.stringify(missing));
  assert.match(missing[0] ?? "", /ae_solve_arc_path/);
});

test("the same rotation on the pivot with the child offset by the radius is an orbit", () => {
  assert.deepEqual(orbitMissing(evidenceRig([0, -400], "path")), []);
  assert.deepEqual(orbitMissing(evidenceRig([0, -400], "holder")), [], "a holder rotating a child 400 px off its anchor orbits too");
});

test("a rotating pivot with a child offset less than 40 px, or a partial turn, is not an orbit", () => {
  const near = snapshotOf([layer("pivot", { properties: [spin()] }), layer("rocket", { parentId: "pivot", properties: [at(30, 0)] })]);
  const partial = snapshotOf([layer("pivot", { properties: [spin({ keyframes: [key(0, 0), key(6, 90)] })] }), layer("rocket", { parentId: "pivot", properties: [at(0, -400)] })]);
  for (const snapshot of [near, partial]) assert.equal(orbitMissing(snapshot).length, 1);
});

test("Position keyed around a circle is an orbit; a straight line, two keys or wiggle alone is not", () => {
  assert.deepEqual(orbitMissing(positionKeyed(CIRCLE)), []);
  assert.equal(orbitMissing(positionKeyed([key(0, [0, 0]), key(1, [100, 100]), key(2, [200, 200])])).length, 1, "three collinear keys are a line");
  assert.equal(orbitMissing(positionKeyed(CIRCLE.slice(0, 2))).length, 1, "two keys are a line");
  assert.equal(orbitMissing(rocketWith(property(`${TRANSFORM}ADBE Position`, { expression: "wiggle(1.5, 22)", expressionEnabled: true }))).length, 1);
});

test("separated X and Y Position keys around a circle are an orbit", () => {
  const axis = (name: string, values: number[]) => property(`${TRANSFORM}ADBE Position_${name}`, { keyframes: values.map((value, index) => key(index, value)), keyframeCount: values.length });
  assert.deepEqual(orbitMissing(rocketWith(axis("0", [810, 1210, 810, 410]), axis("1", [330, 730, 1130, 730]))), []);
});

test("a Position expression with sin and cos is an orbit", () => {
  for (const expression of ["[810 + 400 * Math.cos(time), 730 + 400 * Math.sin(time)]", "[x + r * cos(time), y + r * sin(time)]"]) assert.deepEqual(orbitMissing(rocketWith(property(`${TRANSFORM}ADBE Position`, { expression, expressionEnabled: true }))), [], expression);
});

test("an applied animate_property on Position with curved keys proves an orbit the snapshot does not show; a line does not", () => {
  const apply = (values: readonly JsonValue[]) => [step("animate_property", { target: { layerId: "rocket", propertyPath: `${TRANSFORM}ADBE Position` }, keyframes: values.map((value, index) => ({ time: index, value })) })];
  const bare = snapshotOf([layer("rocket")]);
  assert.deepEqual(orbitMissing(bare, apply(CIRCLE.map((entry) => entry.value))), []);
  assert.equal(orbitMissing(bare, apply([[0, 0], [1, 1], [2, 2]])).length, 1);
  assert.equal(orbitMissing(bare, [step("set_layer_parent")]).length, 1, "no fallback for the pivot rig");
});

// Tests for the solver tools: the arc path, stagger and layer measurement answers, their refusals, and that an arc's operations pass through ae_propose_plan and compile.
import test from "node:test";
import assert from "node:assert/strict";
import { array, decodeOrThrow, number, object, optional, string } from "@extynt/decode";
import { representativeSnapshot } from "@extynt/project-graph";
import { callTool, listTools, type StoredPlan } from "../src/index.js";
import { arrayAt, stringAt } from "../src/json.js";
import type { JsonObject } from "@extynt/decode";
import { compiledPlan } from "./support/compiled-plan.js";
import { payloadOf, refusalOf, resultData } from "./support/json-results.js";

const keyframe = object({ time: number() });
const arcView = object({
  position: object({ propertyPath: string(), keyframes: array(keyframe) }), radius: number(), arcLength: number(),
  rotation: optional(object({ propertyPath: string(), keyframes: array(keyframe) })),
});
const staggerView = object({ starts: optional(array(number())), ranks: optional(array(number())), span: optional(number()), items: optional(array(object({ layerId: string(), start: number() }))) });
const measureView = object({ anchorInComp: array(number()), caveats: array(string()), matrix: array(number()), rotationInComp: number(), scaleInComp: array(number()) });
const arcOperation = object({ type: string(), role: string(), target: optional(object({ compositionId: string(), layerId: string() })) });
const targetedArcView = object({ next: string(), operations: array(arcOperation) });

const LAYER = { compositionId: "comp-main", layerId: "layer-footage" };
const ARC: JsonObject = { center: [100, 100], start: [150, 100], sweep: 90, startTime: 0, duration: 1 };
const withSnapshot = { snapshot: representativeSnapshot };
const arcContext = (): { snapshot: typeof representativeSnapshot; panelSessionId: string; plans: Map<string, StoredPlan> } => ({ snapshot: representativeSnapshot, panelSessionId: "panel-arc", plans: new Map<string, StoredPlan>() });

function refusalFor(name: string, args: JsonObject, context: Parameters<typeof callTool>[2] = {}): { readonly code: string; readonly message: string } {
  return refusalOf(callTool(name, args, context));
}

test("Solver tools are listed in agent toolset", () => {
  const names = new Set(listTools("agent").map((tool) => tool.name));
  assert.ok(names.has("ae_measure_layer"));
  assert.ok(names.has("ae_solve_arc_path"));
  assert.ok(names.has("ae_solve_stagger"));
});

test("ae_solve_arc_path works host-independent with no snapshot", () => {
  const data = decodeOrThrow(arcView, payloadOf(callTool("ae_solve_arc_path", { center: [100, 100], radius: 50, startAngle: 0, sweep: 90, startTime: 0, duration: 1 }, {})));
  assert.equal(data.position.propertyPath, "ADBE Transform Group/ADBE Position");
  assert.ok(data.position.keyframes.length >= 2);
  assert.equal(data.radius, 50);
  assert.equal(typeof data.arcLength, "number");
});

test("ae_solve_arc_path with orient generates rotation keyframes", () => {
  const data = decodeOrThrow(arcView, payloadOf(callTool("ae_solve_arc_path", { center: [100, 100], start: [150, 100], sweep: 180, startTime: 0, duration: 2, orient: { forwardAngle: 0 } }, {})));
  assert.equal(data.rotation?.propertyPath, "ADBE Transform Group/ADBE Rotate Z");
  assert.ok(data.rotation?.keyframes.length);
});

test("ae_solve_arc_path rejects invalid center", () => {
  const error = refusalFor("ae_solve_arc_path", { center: "abc", sweep: 90, startTime: 0, duration: 1 });
  assert.equal(error.code, "INVALID_ARGUMENT");
  assert.match(error.message, /center/i);
});

test("ae_solve_arc_path rejects center with insufficient elements", () => {
  assert.equal(refusalFor("ae_solve_arc_path", { center: [1], sweep: 90, startTime: 0, duration: 1 }).code, "INVALID_ARGUMENT");
});

test("ae_solve_arc_path rejects zero sweep", () => {
  const error = refusalFor("ae_solve_arc_path", { ...ARC, sweep: 0 });
  assert.equal(error.code, "INVALID_ARGUMENT");
  assert.match(error.message, /sweep/i);
});

test("ae_solve_stagger computes start times from count and step", () => {
  const data = decodeOrThrow(staggerView, payloadOf(callTool("ae_solve_stagger", { count: 3, startTime: 0, step: 0.5 }, {})));
  assert.deepEqual(data.starts, [0, 0.5, 1]);
  assert.deepEqual(data.ranks, [0, 1, 2]);
  assert.equal(data.span, 1);
});

test("ae_solve_stagger with layerIds returns items in given order", () => {
  const data = decodeOrThrow(staggerView, payloadOf(callTool("ae_solve_stagger", { layerIds: ["layer-1", "layer-2", "layer-3"], startTime: 0, step: 0.25 }, {})));
  assert.deepEqual(data.items?.map((item) => item.layerId), ["layer-1", "layer-2", "layer-3"]);
});

test("ae_solve_stagger rejects mismatched count and layerIds", () => {
  const error = refusalFor("ae_solve_stagger", { count: 2, layerIds: ["layer-1", "layer-2", "layer-3"], startTime: 0, step: 0.5 });
  assert.equal(error.code, "INVALID_ARGUMENT");
  assert.match(error.message, /count.*match/i);
});

test("ae_measure_layer requires snapshot context", () => {
  assert.equal(refusalFor("ae_measure_layer", LAYER).code, "NO_SNAPSHOT");
});

test("ae_measure_layer on representative snapshot returns anchor and caveats", () => {
  const data = decodeOrThrow(measureView, payloadOf(callTool("ae_measure_layer", LAYER, withSnapshot)));
  assert.equal(data.anchorInComp.length, 2);
  assert.equal(data.matrix.length, 6);
});

test("ae_measure_layer rejects unknown layer", () => {
  assert.equal(refusalFor("ae_measure_layer", { ...LAYER, layerId: "unknown-layer" }, withSnapshot).code, "LAYER_NOT_FOUND");
});

test("ae_measure_layer rejects unknown composition", () => {
  assert.equal(refusalFor("ae_measure_layer", { ...LAYER, compositionId: "unknown-comp" }, withSnapshot).code, "COMPOSITION_NOT_FOUND");
});

test("ae_solve_arc_path with target returns animate_property operations", () => {
  const data = decodeOrThrow(targetedArcView, payloadOf(callTool("ae_solve_arc_path", { ...ARC, target: LAYER }, arcContext())));
  const first = data.operations[0];
  assert.equal(first?.type, "animate_property");
  assert.equal(first?.role, "transform.position");
  assert.deepEqual(first?.target, LAYER);
  assert.match(data.next, /as they are/);
});

test("ae_solve_arc_path with target and orient has position and rotation operations", () => {
  const data = decodeOrThrow(targetedArcView, payloadOf(callTool("ae_solve_arc_path", { ...ARC, sweep: 180, duration: 2, orient: { forwardAngle: 90 }, target: LAYER }, arcContext())));
  assert.deepEqual(data.operations.map((operation) => [operation.type, operation.role]), [["animate_property", "transform.position"], ["animate_property", "transform.rotation"]]);
});

test("ae_solve_arc_path operations validate with ae_propose_plan and compile correctly", () => {
  const context = arcContext();
  const arc = callTool("ae_solve_arc_path", { ...ARC, orient: { forwardAngle: -90 }, target: LAYER }, context);
  assert.equal(arc.ok, true);
  const proposal = callTool("ae_propose_plan", { summary: "Test arc path motion", operations: arrayAt(resultData(arc), "operations") ?? [] }, context);
  assert.equal(proposal.ok, true, JSON.stringify(proposal));
  const planId = stringAt(resultData(proposal), "planId");
  assert.ok(planId);
  const compiled = compiledPlan(context.plans.get(planId), representativeSnapshot);
  assert.equal("ok" in compiled, false, JSON.stringify(compiled));
  assert.ok("operations" in compiled && compiled.operations.length >= 2);
});

test("ae_solve_arc_path refuses a malformed target instead of dropping it", () => {
  const error = refusalFor("ae_solve_arc_path", { ...ARC, target: { layerId: "layer-footage" } }, withSnapshot);
  assert.equal(error.code, "INVALID_ARGUMENT");
  assert.match(error.message, /target/);
});

const STAGGER: JsonObject = { count: 3, startTime: 0, step: 0.1 };
const stagger = (extra: JsonObject): { readonly code: string; readonly message: string } => refusalFor("ae_solve_stagger", { ...STAGGER, ...extra });

test("ae_solve_stagger says count is required when neither count nor layerIds is given", () => {
  const error = refusalFor("ae_solve_stagger", { startTime: 0, step: 0.1 });
  assert.equal(error.code, "INVALID_ARGUMENT");
  assert.equal(error.message, "count is required, or pass layerIds.");
});

test("ae_solve_stagger names the first field its spec cannot decode: startTime, step, total, order, seed, curve, itemDuration", () => {
  assert.equal(refusalFor("ae_solve_stagger", {}).message, "$.startTime: expected finite number, found undefined");
  assert.equal(refusalFor("ae_solve_stagger", { count: 3 }).message, "$.startTime: expected finite number, found undefined");
  assert.equal(stagger({ startTime: "0", step: "x" }).message, "$.startTime: expected finite number, found string");
  assert.equal(stagger({ step: "x", order: "sideways" }).message, "$.step: expected finite number, found string");
  assert.equal(stagger({ order: "sideways", curve: "wavy", seed: "s", itemDuration: "d" }).message, "$.order: expected \"forward\" or \"reverse\" or \"center-out\" or \"edges-in\" or \"random\", found \"sideways\"");
  assert.equal(stagger({ curve: "wavy", itemDuration: "d" }).message, "$.curve: expected \"linear\" or \"ease-in\" or \"ease-out\" or \"ease-in-out\", found \"wavy\"");
  assert.equal(stagger({ seed: "s", curve: "wavy", itemDuration: "d" }).message, "$.seed: expected finite number, found string");
  assert.equal(stagger({ itemDuration: "d" }).message, "$.itemDuration: expected finite number, found string");
});

test("ae_solve_stagger refuses a count that is not a number, and leaves exactly-one-of-step-or-total to the solver", () => {
  assert.equal(stagger({ count: "3" }).message, "$.count: expected finite number, found string");
  assert.match(stagger({ total: 1 }).message, /exactly one of step or total/);
  assert.match(refusalFor("ae_solve_stagger", { count: 3, startTime: 0 }).message, /exactly one of step or total/);
});

test("ae_solve_stagger, ae_solve_arc_path name the allowed values of a bad order, curve or speed", () => {
  assert.equal(stagger({ order: "invalid-order" }).code, "INVALID_ARGUMENT");
  assert.equal(stagger({ order: 3 }).message, "$.order: expected \"forward\" or \"reverse\" or \"center-out\" or \"edges-in\" or \"random\", found 3");
  assert.equal(stagger({ curve: "invalid-curve" }).message, "$.curve: expected \"linear\" or \"ease-in\" or \"ease-out\" or \"ease-in-out\", found \"invalid-curve\"");
  const arc = refusalFor("ae_solve_arc_path", { ...ARC, speed: "warp" });
  assert.equal(arc.code, "INVALID_ARGUMENT");
  assert.equal(arc.message, "$.speed: expected \"constant\" or \"accelerate\" or \"decelerate\" or \"ease-in-out\", found \"warp\"");
  assert.equal(refusalFor("ae_solve_arc_path", { ...ARC, speed: 2 }).message, "$.speed: expected \"constant\" or \"accelerate\" or \"decelerate\" or \"ease-in-out\", found 2");
});

test("ae_solve_arc_path names an argument of the wrong type, and a required one that is absent the same way", () => {
  assert.equal(refusalFor("ae_solve_arc_path", { center: [100, 100], start: [150, 100], sweep: 90, startTime: 0 }).message, "$.duration: expected finite number, found undefined");
  assert.equal(refusalFor("ae_solve_arc_path", { ...ARC, sweep: "90" }).message, "$.sweep: expected finite number, found string");
  assert.equal(refusalFor("ae_solve_arc_path", { ...ARC, center: [1, "x"] }).message, "$.center[1]: expected finite number, found string");
  assert.equal(refusalFor("ae_solve_arc_path", { ...ARC, center: [1, 2, 3] }).message, "center must be a 2-element array");
  assert.equal(refusalFor("ae_solve_arc_path", { ...ARC, orient: [] }).message, "$.orient: expected object, found array");
  assert.equal(refusalFor("ae_solve_arc_path", { ...ARC, orient: { forwardAngle: "x" } }).message, "$.orient.forwardAngle: expected finite number, found string");
});

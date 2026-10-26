// The named request decisions: each takes a typed input and answers one label from an exported set.
import test from "node:test";
import assert from "node:assert/strict";
import { buildKit, decideSceneRequest, SCENE_LABELS } from "../src/build-kit.js";
import { LAYER_STYLE_LABELS, decideLayerStyleRequest, requestNamesLayerStyle } from "../src/layer-style-request.js";
import { ASK_LABELS, COVERAGE_LABELS, decideFeatureAsk, decideFeatureCoverage, decideNameAsk } from "../src/request-coverage.js";
import { effect, factsOf, layer, snapshotOf, step } from "./coverage-fixtures.js";

const GLOW_GOAL = "Give the title a glow";

test("the label sets are the full answer space of each decision", () => {
  assert.deepEqual([...ASK_LABELS], ["asked", "not-asked"]);
  assert.deepEqual([...COVERAGE_LABELS], ["covered", "missing", "hidden"]);
  assert.deepEqual([...LAYER_STYLE_LABELS], ["names-layer-style", "does-not-name"]);
  assert.deepEqual([...SCENE_LABELS], ["drawn-scene", "arranged-layers"]);
});

const FEATURE_ASKS = [
  { goal: GLOW_GOAL, feature: "glow", label: "asked" },
  { goal: "No glow on the title", feature: "glow", label: "not-asked" },
  { goal: "Add a drop shadow", feature: "glow", label: "not-asked" },
  { goal: "Add a drop shadow", feature: "drop-shadow", label: "asked" },
  { goal: "Add a camera with a slow push-in.", feature: "camera-move", label: "asked" },
  { goal: "Don't dolly anything.", feature: "camera-move", label: "not-asked" },
] as const;

test("decideFeatureAsk answers asked or not-asked per feature", () => {
  for (const { goal, feature, label } of FEATURE_ASKS) assert.equal(decideFeatureAsk({ goal, feature }), label, `${feature}: ${goal}`);
});

const NAME_ASKS = [
  { goal: "Build EXTYNT_LAUNCH_30 now", name: "EXTYNT_LAUNCH_30", label: "asked" },
  { goal: "Do not add a DEBUG_GUIDE", name: "DEBUG_GUIDE", label: "not-asked" },
] as const;

test("decideNameAsk answers by the name's place in the goal, and a negated name is not asked", () => {
  for (const { goal, name, label } of NAME_ASKS) assert.equal(decideNameAsk({ goal, name, index: goal.indexOf(name) }), label, name);
});

const COVERAGE_CASES = [
  { name: "an effect on a shown layer covers it", layers: [layer("title", { type: "text", properties: [effect("ADBE Glo2")] })], steps: [], label: "covered" },
  { name: "no effect and nothing applied is missing", layers: [layer("title", { type: "text" })], steps: [], label: "missing" },
  { name: "an effect on a hidden layer is hidden", layers: [layer("title", { type: "text", enabled: false, properties: [effect("ADBE Glo2")] })], steps: [], label: "hidden" },
  { name: "an applied ensure_effect for the glow covers it", layers: [layer("title", { type: "text" })], steps: [step("ensure_effect", { effectPath: "ADBE Effect Parade/ADBE Glo2" })], label: "covered" },
] as const;

test("decideFeatureCoverage answers covered, missing or hidden from the evidence", () => {
  for (const { name, layers, steps, label } of COVERAGE_CASES) assert.equal(decideFeatureCoverage({ feature: "glow", evidence: { snapshot: snapshotOf(layers), applied: factsOf(steps) } }), label, name);
});

const LAYER_STYLE_CASES = [
  { input: { message: "add a drop shadow and a glow to the title" }, label: "does-not-name" },
  { input: { message: "give the logo a Layer Style drop shadow" }, label: "names-layer-style" },
  { input: { message: "continue", workflowGoalSummary: "apply layer-styles to every title" }, label: "names-layer-style" },
] as const;

test("decideLayerStyleRequest names Layer Styles only in those words, and the boolean form delegates to it", () => {
  for (const { input, label } of LAYER_STYLE_CASES) {
    assert.equal(decideLayerStyleRequest(input), label, input.message);
    assert.equal(requestNamesLayerStyle(input), label === "names-layer-style", input.message);
  }
});

const SCENE_CASES = [
  { request: "Draw a rocket orbiting a ringed planet over a starfield", label: "drawn-scene" },
  { request: "Make the title bigger", label: "arranged-layers" },
] as const;

test("decideSceneRequest separates a drawn scene from arranged layers, and the kit follows it", () => {
  for (const { request, label } of SCENE_CASES) {
    assert.equal(decideSceneRequest({ request }), label, request);
    assert.equal(buildKit(request, "comp-main", undefined).includes("ae_propose_plan {svg}"), label === "drawn-scene", request);
  }
});

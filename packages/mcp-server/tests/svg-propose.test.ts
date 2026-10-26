// Tests that ae_propose_plan {svg} compiles a drawing into native shape-layer operations, maps the layers, follows a plan-created composition, and refuses drawings that do not compile or have no target.
import assert from "node:assert/strict";
import test from "node:test";
import { array, decodeOrThrow, object, string } from "@extynt/decode";
import { representativeSnapshot } from "@extynt/project-graph";
import { callTool } from "../src/index.js";
import type { StoredPlan } from "../src/index.js";
import { stringAt } from "../src/json.js";
import { payloadOf, refusalOf, storedOperations } from "./support/json-results.js";

const [comp] = representativeSnapshot.compositions;
assert.ok(comp, "the snapshot has a composition");

const scene = `<svg viewBox="0 0 ${comp.width} ${comp.height}">
  <g id="Planet"><circle cx="${comp.width / 2}" cy="${comp.height / 2}" r="200" fill="#c84"/></g>
  <g id="Ring" data-anchor="center" data-repeat="4" data-repeat-offset="scale(1.1)"><ellipse cx="${comp.width / 2}" cy="${comp.height / 2}" rx="300" ry="60" fill="none" stroke="#fda" stroke-width="6"/></g>
  <g id="Stars" data-repeat="30" data-repeat-offset="translate(40 10)"><circle cx="20" cy="20" r="3" fill="#fff"/></g>
</svg>`;

const proposalView = object({
  planId: string(),
  svgScene: object({ compositionId: string(), layers: array(object({ name: string(), layerId: string() })) }),
});

const context = () => ({ snapshot: representativeSnapshot, plans: new Map<string, StoredPlan>() });
const typesOf = (plan: StoredPlan | undefined) => storedOperations(plan).map((operation) => stringAt(operation, "type"));

test("ae_propose_plan {svg} compiles the drawing into native shape-layer operations and maps the layers", () => {
  const ctx = context();
  const data = decodeOrThrow(proposalView, payloadOf(callTool("ae_propose_plan", { summary: "Planet", svg: scene, compositionId: comp.id }, ctx)));
  const types = typesOf(ctx.plans.get(data.planId));
  assert.equal(types.filter((type) => type === "create_layer").length, 3);
  assert.ok(types.includes("draw_vector_shapes"));
  assert.ok(types.includes("add_shape_item"), "data-repeat becomes a native Repeater");
  assert.equal(data.svgScene.compositionId, comp.id);
  assert.deepEqual(data.svgScene.layers.map((layer) => layer.name), ["Planet", "Ring", "Stars"]);
});

test("svg layers follow a plan-created composition and come before the other operations", () => {
  const ctx = context();
  const created = callTool("ae_propose_plan", {
    summary: "Scene", svg: scene,
    operations: [{ type: "create_composition", newCompositionId: "__new__:scene", name: "Scene", width: comp.width, height: comp.height, durationSeconds: 6, frameRate: 30 }],
  }, ctx);
  const data = decodeOrThrow(proposalView, payloadOf(created));
  const types = typesOf(ctx.plans.get(data.planId));
  assert.equal(types[0], "create_composition");
  assert.equal(types[1], "create_layer");
  assert.equal(data.svgScene.compositionId, "__new__:scene");
  assert.ok(data.svgScene.layers.every((layer) => layer.layerId.startsWith("__new__:")));
});

test("an svg that does not compile is refused with the compiler's message", () => {
  const result = callTool("ae_propose_plan", { summary: "Bad", svg: "<svg viewBox=\"0 0 100 100\"><g id=\"A\"><script>x</script></g>", compositionId: comp.id }, context());
  assert.match(refusalOf(result).message, /^The scene drawing did not compile \(SVG_[A-Z_]+\): /u);
});

test("an svg with no target composition of its size is refused", () => {
  const result = callTool("ae_propose_plan", { summary: "Odd", svg: "<svg viewBox=\"0 0 123 77\"><g id=\"A\"><rect width=\"10\" height=\"10\" fill=\"#fff\"/></g></svg>" }, context());
  assert.equal(refusalOf(result).code, "COMPOSITION_TARGET_REQUIRED");
});

test("a layer too heavy for one batch is split into sibling layers", () => {
  const dots = Array.from({ length: 250 }, (_, index) => `<circle cx="${10 + index * 8}" cy="${10 + (index % 7) * 9}" r="2" fill="#fff"/>`).join("");
  const result = callTool("ae_propose_plan", { summary: "Stars", svg: `<svg viewBox="0 0 ${comp.width} ${comp.height}"><g id="Stars">${dots}</g></svg>`, compositionId: comp.id }, context());
  const names = decodeOrThrow(proposalView, payloadOf(result)).svgScene.layers.map((layer) => layer.name);
  assert.deepEqual(names.slice(0, 2), ["Stars", "Stars 2"]);
});

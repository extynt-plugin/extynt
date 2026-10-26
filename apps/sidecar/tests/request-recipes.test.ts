/** The resolved-recipe block: what it carries for the S4 title-ident request, that its examples validate, its size, and that it sits in the cached half. */
import { callTool, type StoredPlan } from "@extynt/mcp-server";
import { representativeSnapshot } from "@extynt/project-graph";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildAgentBriefing, buildAgentBriefingSegments, estimateTokens } from "../src/agent.js";
import { recipeBlock, recipeOperations } from "../src/request-recipes.js";

type Operation = ReturnType<typeof recipeOperations>[number];

const S4_PROMPT = readFileSync(new URL("../../tests/fixtures/s4-prompt.txt", import.meta.url), "utf8");
const COMPOSITION = "comp-main";
const RECIPE_TOKEN_BUDGET = 2500;

function queue(operations: readonly Operation[]) {
  const state: { planId: string | null; set: (id: string | null) => void } = { planId: null, set: (id) => { state.planId = id; } };
  return callTool("ae_queue_add", { operations }, { snapshot: representativeSnapshot, plans: new Map<string, StoredPlan>(), queue: state });
}

const layer = (id: string, layerType: string, extra: Operation = {}): Operation => ({ type: "create_layer", target: { layerId: id }, layerType, name: id.slice(8), ...extra });
const PLACEHOLDER_LAYERS = [layer("__new__:title", "text", { text: "SIGNAL" }), layer("__new__:shape", "shape"), layer("__new__:shine", "shape")];

test("the S4 prompt resolves every named capability into one block, and the briefing size before and after is measured", () => {
  const before = buildAgentBriefing(representativeSnapshot, { providerName: "DeepSeek" });
  const after = buildAgentBriefing(representativeSnapshot, { providerName: "DeepSeek", requestGoal: S4_PROMPT });
  const block = recipeBlock(S4_PROMPT, COMPOSITION).join("\n");
  const [tokensBefore, tokensAfter, tokensBlock] = [estimateTokens(before), estimateTokens(after), estimateTokens(block)];
  console.log(`S4 briefing: ${tokensBefore} tokens before, ${tokensAfter} after (+${tokensAfter - tokensBefore}); recipe block alone ${tokensBlock} tokens, ${block.length} chars`);
  assert.ok(tokensAfter - tokensBefore <= RECIPE_TOKEN_BUDGET, `the block adds ${tokensAfter - tokensBefore} tokens`);
  assert.match(block, /do not search or describe these capabilities/);
  for (const needle of ["ADBE Glo2", "adobe.glow", "ADBE Drop Shadow", "ADBE Gaussian Blur 2", "ADBE Ramp", "add_text_animator", "selector.offset", "out-expo", "set_track_matte", "item\":\"repeater", "layerType\":\"camera", "layerType\":\"null", "set_layer_parent", "three-d", "set_expression", "add_marker", "add_essential_property", "Glow Radius ADBE Glo2-0003", "Ramp Shape ADBE Ramp-0005"]) assert.ok(block.includes(needle), `the block carries ${needle}`);
  assert.ok(block.includes(`"compositionId":"${COMPOSITION}"`), "the marker targets the open composition");
});

test("every example in the block is accepted by the queue validator, in the order the block gives them", () => {
  const operations = recipeOperations(S4_PROMPT, COMPOSITION);
  assert.ok(operations.length >= 14, `the S4 block carries ${operations.length} operations`);
  const result = queue([...PLACEHOLDER_LAYERS, ...operations]);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.error));
});

test("a smaller request gets only its own recipes, and the wiggle follows the glow only when a glow is asked for", () => {
  const trim = "Draw a ring with trim paths and a wiggle on the position, and add a drop shadow.";
  const block = recipeBlock(trim, COMPOSITION).join("\n");
  assert.match(block, /trim-paths/);
  assert.match(block, /wiggle\(2, 30\)/);
  assert.doesNotMatch(block, /repeater|add_text_animator|set_track_matte|ADBE Glo2|ADBE Ramp|camera/);
  const result = queue([...PLACEHOLDER_LAYERS, ...recipeOperations(trim, COMPOSITION)]);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.error));
});

test("a request that names none of the features, or negates them, adds nothing", () => {
  assert.deepEqual(recipeBlock("Make the title bigger", COMPOSITION), []);
  assert.deepEqual(recipeBlock("Rename the layer, no glow and without a camera", COMPOSITION), []);
});

test("the block is in the cached half of the briefing and without a goal the briefing is unchanged", () => {
  const options = { providerName: "DeepSeek", requestGoal: S4_PROMPT };
  const [stable, live] = buildAgentBriefingSegments(representativeSnapshot, options);
  assert.equal(stable?.cache, true);
  assert.match(stable?.text ?? "", /Resolved for this request/);
  assert.doesNotMatch(live?.text ?? "", /Resolved for this request/);
  assert.equal(buildAgentBriefing(representativeSnapshot, { providerName: "DeepSeek" }), buildAgentBriefing(representativeSnapshot, { providerName: "DeepSeek", requestGoal: "hello" }));
});

test("the camera recipe pushes in with dolly_camera in the same queue as the camera, states what distance means, and sends no coordinates", () => {
  const goal = "Add a camera with a slow push-in across the comp.";
  const block = recipeBlock(goal, COMPOSITION).join("\n");
  assert.match(block, /dolly_camera/);
  assert.match(block, /distance is pixels from the camera to its point of interest/);
  assert.match(block, /2667/);
  assert.match(block, /2200/);
  assert.doesNotMatch(block, /animate_property/);
  const operations = recipeOperations(goal, COMPOSITION);
  assert.deepEqual(operations.map((operation) => operation.type), ["create_layer", "dolly_camera"]);
  const result = queue([...PLACEHOLDER_LAYERS, ...operations]);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.error));
});

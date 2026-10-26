/** The common operation shapes in the briefing are exact: each parses, and the queue accepts them as a batch. */
import { callTool, type StoredPlan } from "@extynt/mcp-server";
import { representativeSnapshot } from "@extynt/project-graph";
import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentBriefing } from "../src/agent.js";
import type { ChatAgentInput } from "../src/server-chat-agent-types.js";
import { workflowBriefing } from "../src/workflow-contract.js";
import { parseJson, recordOf, type JsonObject } from "./http-json.js";

const HEADING = "Common operation shapes (exact; queue them directly; describe only operations not shown here)";
const workflowInput: ChatAgentInput = { requestId: "req-shapes", message: "", history: [], autoApply: false, workflowJobId: "job-1", workflowCycle: 0 };

function blockLines(briefing: string): string[] {
  const lines = briefing.split("\n");
  const heading = lines.find((line) => line.startsWith(HEADING));
  assert.ok(heading !== undefined, "the briefing carries the common shapes block");
  const rest = lines.slice(lines.indexOf(heading) + 1);
  const end = rest.findIndex((line) => !line.includes(": {"));
  return [heading, ...rest.slice(0, end < 0 ? rest.length : end)];
}

function shapeLines(briefing: string): Array<{ label: string; operation: JsonObject }> {
  return blockLines(briefing).slice(1).map((line) => {
    const brace = line.indexOf(": {");
    return { label: line.slice(0, brace).replace(/ \(.*\)$/, ""), operation: recordOf(parseJson(line.slice(brace + 2)), "") };
  });
}

function queue(operations: JsonObject[]) {
  const slot: { planId: string | null; set: (id: string | null) => void } = { planId: null, set: (id) => { slot.planId = id; } };
  return callTool("ae_queue_add", { operations }, { snapshot: representativeSnapshot, plans: new Map<string, StoredPlan>(), queue: slot });
}

test("every common shape parses and one ae_queue_add batch of them is accepted, a new comp and its layers included", () => {
  const shapes = shapeLines(buildAgentBriefing(representativeSnapshot, { providerName: "DeepSeek" }));
  assert.deepEqual(shapes.map((shape) => shape.label), ["create_composition", "create_layer", "set_layer_property", "animate_property", "set_expression", "set_layer_parent", "set_layer_timing", "add_marker"]);
  for (const shape of shapes) assert.equal(shape.operation.type, shape.label);
  const [composition, layer, ...rest] = shapes.map((shape) => shape.operation);
  assert.ok(composition && layer, "the block opens with the composition and the layer");
  const parent = { ...layer, target: { compositionId: "__new__:scene", layerId: "__new__:b" }, name: "Parent" };
  const batch = queue([composition, layer, parent, ...rest]);
  assert.equal(batch.ok, true, JSON.stringify(batch.ok ? null : batch.error));
});

test("the plain and the workflow briefing both carry the same compact block", () => {
  const plain = buildAgentBriefing(representativeSnapshot, { providerName: "DeepSeek" });
  const workflow = workflowBriefing(plain, workflowInput);
  assert.equal(blockLines(workflow).join("\n"), blockLines(plain).join("\n"));
  assert.ok(blockLines(plain).join("\n").length <= 1450, `the block is ${blockLines(plain).join("\n").length} chars`);
  assert.doesNotMatch(plain, /Operation vocabulary by family/);
});

test("the screenshot policy rules out capturing the untouched comp before an edit", () => {
  assert.match(buildAgentBriefing(representativeSnapshot), /nor before an edit to see the starting state/);
});

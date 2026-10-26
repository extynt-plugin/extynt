// Tests that ae_create_vector_artwork is an approval-plan tool with trusted SVG evidence, refuses unsafe SVG and linked mode, and advertises inline SVG text rather than a path.
import test from "node:test";
import assert from "node:assert/strict";
import { array, boolean, decodeOrThrow, jsonObject, object, string } from "@extynt/decode";
import { representativeSnapshot } from "@extynt/project-graph";
import { callTool, listTools } from "../src/index.js";
import type { StoredPlan } from "../src/index.js";
import { jsonFieldsOf, numberAt, objectAt, stringAt } from "../src/json.js";
import { compiledOperations } from "./support/compiled-plan.js";
import { payloadOf, refusalOf } from "./support/json-results.js";

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><radialGradient id="g"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#08f"/></radialGradient></defs><g transform="rotate(15 50 50)"><circle cx="50" cy="50" r="40" fill="url(#g)"/></g></svg>';

const proposalView = object({
  planId: string(),
  plan: object({ operations: array(jsonObject) }),
  presentation: object({ approvalRequired: boolean() }),
  approvalCapability: object({ oneTime: boolean() }),
});

const vectorTool = () => {
  const definition = listTools("agent").find((tool) => tool.name === "ae_create_vector_artwork");
  assert.ok(definition, "the tool is listed");
  return definition;
};

test("ae_create_vector_artwork is a first-class approval-plan tool and computes trusted SVG evidence", () => {
  const plans = new Map<string, StoredPlan>();
  const context = { snapshot: representativeSnapshot, panelSessionId: "panel-vector", plans };
  const result = callTool("ae_create_vector_artwork", { svg, name: "Orbit Mark", importMode: "editable", targetCompositionId: "comp-main", layerName: "ORBIT — Vector Mark" }, context);
  const data = decodeOrThrow(proposalView, payloadOf(result));
  assert.equal(data.presentation.approvalRequired, true);
  assert.equal(data.approvalCapability.oneTime, true);
  assert.deepEqual(data.plan.operations.map((operation) => stringAt(operation, "type")), ["create_vector_artwork", "create_layer"]);
  const create = data.plan.operations[0];
  const composition = representativeSnapshot.compositions.find((candidate) => candidate.id === "comp-main");
  assert.equal(stringAt(create, "importMode"), "editable");
  assert.equal(stringAt(create, "managedSourcePolicy"), "retain");
  assert.equal(numberAt(create, "durationSeconds"), composition?.duration);
  assert.equal(numberAt(create, "frameRate"), composition?.frameRate);
  assert.match(stringAt(create, "sourceHash") ?? "", /^[a-f0-9]{64}$/u);
  assert.equal(numberAt(objectAt(create, "metadata"), "gradients"), 1);
  assert.equal(create !== undefined && "path" in create, false);
  const stored = plans.get(data.planId);
  assert.equal(stored?.status, "prepared");
  const compiled = compiledOperations(stored, representativeSnapshot);
  assert.deepEqual(compiled.map((operation) => stringAt(operation, "operation")), ["create_vector_artwork", "create_layer"]);
  assert.equal(numberAt(compiled[0], "durationSeconds"), numberAt(create, "durationSeconds"));
  assert.equal(numberAt(compiled[0], "frameRate"), numberAt(create, "frameRate"));
  assert.equal(callTool("ae_present_plan", { planId: data.planId }, context).ok, true);
  assert.equal(callTool("ae_approve_plan", { planId: data.planId, acknowledgeUnverified: true }, context).ok, true);
  assert.equal(plans.get(data.planId)?.status, "approved");
});

test("ae_create_vector_artwork refuses unsafe SVG and linked lifecycle before creating a plan", () => {
  const context = { snapshot: representativeSnapshot, panelSessionId: "panel-vector", plans: new Map<string, StoredPlan>() };
  const unsafe = callTool("ae_create_vector_artwork", { svg: '<svg><script src="https://example.com/x.js"/></svg>', name: "Unsafe" }, context);
  assert.equal(refusalOf(unsafe).code, "SVG_UNSAFE");
  const linked = callTool("ae_create_vector_artwork", { svg, name: "Linked", importMode: "linked" }, context);
  assert.equal(refusalOf(linked).code, "VECTOR_MODE_UNSUPPORTED");
  assert.equal(context.plans.size, 0);
});

test("tool surface advertises bounded inline SVG without an arbitrary path", () => {
  const definition = vectorTool();
  const properties = jsonFieldsOf(definition.inputSchema.properties);
  assert.ok(properties.svg);
  assert.equal(properties.path, undefined);
  assert.equal(definition.planCard, true);
});

test("tool surface tells agents holding an .svg file to read it and pass the text", () => {
  const definition = vectorTool();
  assert.match(definition.description, /never a file path/);
  assert.match(definition.description, /read the file and pass its complete contents unchanged as `svg`/);
  assert.match(definition.description, /no path parameter/i);
  const svgDescription = stringAt(objectAt(jsonFieldsOf(definition.inputSchema.properties), "svg"), "description") ?? "";
  assert.match(svgDescription, /not a file path/);
  assert.match(svgDescription, /contents of an \.svg file/);
  assert.match(svgDescription, /No DTD\/entities, scripts, handlers, foreignObject/);
});

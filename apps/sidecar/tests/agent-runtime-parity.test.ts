/** Parity between the two runtimes: the in-panel agent and the external MCP agent both derive their tools from packages/mcp-server/src/tool-catalogue.ts, so their names, schemas and runtime split cannot drift apart silently. */
import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, EXTERNAL_HIDDEN_TOOLS, IN_PANEL_AGENT_HIDDEN_TOOLS, listTools, PANEL_AGENT_ONLY_TOOLS, TOOL_DEFINITIONS, type ToolDefinition } from "@extynt/mcp-server";
import { AGENT_GUIDE_SPEC } from "../src/agent-guides.js";
import { agentToolSpecs } from "../src/agent-tool-specs.js";
import { AGENT_VISION_TOOLS } from "../src/agent-policy.js";
import { WORKFLOW_ASK_TOOL, WORKFLOW_CHECKLIST_TOOL, WORKFLOW_DESIGN_TOOL, WORKFLOW_SPECIALIST_TOOL, WORKFLOW_UNBUILT_TOOL } from "../src/agent-types.js";
import { webSearchToolSpec } from "../src/web-search.js";

const ALL_TURN_OPTIONS = { acceptsImages: true, webSearch: true, workflowStage: true, workflowSpecialists: true, workflowChecklist: true };
const ADJUSTED_IN_PANEL: ReadonlySet<string> = new Set(["ae_workflow_complete", "ae_measure_layer", "ae_capture_composition_frame", "ae_queue_add", "ae_queue_finish"]);
const INTERNAL_ONLY: readonly string[] = ["ae_get_fresh_edit_context", "ae_prepare_change", "ae_present_plan"];
const SIDECAR_OWNED: readonly string[] = [AGENT_GUIDE_SPEC.name, WORKFLOW_ASK_TOOL, WORKFLOW_CHECKLIST_TOOL, WORKFLOW_UNBUILT_TOOL, WORKFLOW_SPECIALIST_TOOL, WORKFLOW_DESIGN_TOOL, webSearchToolSpec().name];

const catalogue: ReadonlyMap<string, ToolDefinition> = new Map(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));
const externalTools: ReadonlyArray<ToolDefinition> = listTools("agent");
const externalNames = new Set(externalTools.map((tool) => tool.name));
const panelSpecs = agentToolSpecs(ALL_TURN_OPTIONS);
const panelCatalogueSpecs = panelSpecs.filter((spec) => catalogue.has(spec.name));
const panelNames = new Set(panelCatalogueSpecs.map((spec) => spec.name));

const schemaOf = (tool: ToolDefinition): string => canonicalJson(Object.fromEntries(Object.entries(tool.inputSchema)));

test("every tool the external agent is offered is the catalogue entry, unchanged", () => {
  for (const tool of externalTools) {
    const entry = catalogue.get(tool.name);
    assert.ok(entry, `${tool.name} is a catalogue tool`);
    assert.equal(canonicalJson(tool), canonicalJson(entry), `${tool.name} is listed exactly as the catalogue defines it`);
  }
});

test("every catalogue tool the panel agent is offered carries the catalogue name, description and input schema, except the in-panel adjustments", () => {
  for (const spec of panelCatalogueSpecs.filter((candidate) => !ADJUSTED_IN_PANEL.has(candidate.name))) {
    const entry = catalogue.get(spec.name);
    assert.ok(entry, `${spec.name} is a catalogue tool`);
    assert.equal(canonicalJson(spec.parameters), schemaOf(entry), `${spec.name} has the catalogue input schema`);
    assert.equal(spec.description, entry.description, `${spec.name} has the catalogue description`);
  }
});

test("the in-panel adjustments only add to a catalogue schema, never drop a catalogue field", () => {
  const additive = panelCatalogueSpecs.filter((spec) => ADJUSTED_IN_PANEL.has(spec.name) && spec.name !== "ae_workflow_complete");
  for (const spec of additive) {
    const catalogueProperties = Object.keys(catalogue.get(spec.name)?.inputSchema.properties ?? {});
    const panelProperties = Object.keys(spec.parameters.properties ?? {});
    for (const property of catalogueProperties) assert.ok(panelProperties.includes(property), `${spec.name} keeps catalogue field ${property}`);
  }
});

test("the panel offers only tools outside the plan lifecycle, and the external list excludes the panel-only and external-hidden sets", () => {
  for (const name of panelNames) assert.ok(!IN_PANEL_AGENT_HIDDEN_TOOLS.has(name), `${name} is hidden from the in-panel agent`);
  for (const name of externalNames) {
    assert.ok(!PANEL_AGENT_ONLY_TOOLS.has(name), `${name} is panel-only`);
    assert.ok(!EXTERNAL_HIDDEN_TOOLS.has(name), `${name} is hidden from external clients`);
  }
});

test("each catalogue tool is on the side its markers say, and the tools neither runtime offers are exactly the internal ones", () => {
  const neither: string[] = [];
  for (const name of catalogue.keys()) {
    if (externalNames.has(name)) continue;
    const onPanel = panelNames.has(name) || AGENT_VISION_TOOLS.has(name);
    const marked = PANEL_AGENT_ONLY_TOOLS.has(name) || EXTERNAL_HIDDEN_TOOLS.has(name);
    if (!marked && !onPanel) neither.push(name);
  }
  assert.deepEqual(neither.sort(), [...INTERNAL_ONLY].sort());
});

test("panel-only queue and workflow tools reach the panel and never the external list", () => {
  for (const name of PANEL_AGENT_ONLY_TOOLS) {
    assert.ok(catalogue.has(name), `${name} is a catalogue tool`);
    assert.ok(!externalNames.has(name), `${name} is not external`);
    if (name === "ae_queue_add" || name === "ae_queue_fix" || name === "ae_queue_finish") assert.ok(panelNames.has(name), `${name} is offered to the panel`);
  }
});

test("the only panel tools outside the catalogue are the sidecar's own workflow, guide and web-search specs", () => {
  const sidecarNames = panelSpecs.map((spec) => spec.name).filter((name) => !catalogue.has(name));
  assert.deepEqual([...sidecarNames].sort(), [...SIDECAR_OWNED].sort());
  for (const name of SIDECAR_OWNED) assert.ok(!externalNames.has(name), `${name} is sidecar-owned, not external`);
});

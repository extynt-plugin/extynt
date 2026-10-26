/** The in-panel tool block: a small fixed core plus a dispatcher, so every call carries a fraction of the ~50 schemas. The block ceilings leave roughly 10% headroom over the measured size; the external MCP surface changes only on purpose, with its sha256 pin updated alongside. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { runAgent, type AgentAdmissionLogLine, type AgentLogLine, type ToolPayload, type ToolResult } from "../src/agent.js";
import { agentToolSpecs } from "../src/agent-tool-specs.js";
import { estimateTokens } from "../src/agent-policy.js";
import { CORE_TOOLS, toolSurface } from "../src/agent-tool-surface.js";
import { canonicalJson, listTools } from "@extynt/mcp-server";
import { MockProvider, type AgentToolCall } from "@extynt/llm";

const STANDARD_TURN = { acceptsImages: true, workflowStage: true, workflowSpecialists: true };
const MAX_TOOL_BLOCK_CHARS = 15_000;
const MAX_TOOL_BLOCK_TOKENS = 4_300;
const EXTERNAL_SURFACE_SHA256 = "776c8e47736ea1bc70ca122ea44ae08155e8594f436cdb40bc12dfe071c42bae";

const ok = (data: ToolPayload = {}): ToolResult => ({ ok: true, data });
const trace = { id: "m1", name: "ae_call_tool", arguments: { name: "ae_trace_dependencies", arguments: { compositionId: "comp-1", layerId: "layer-1" } } };

test("the in-panel tool block stays small: a core plus two meta tools", () => {
  const offered = toolSurface(agentToolSpecs(STANDARD_TURN)).offered;
  const json = JSON.stringify(offered);
  assert.ok(json.length <= MAX_TOOL_BLOCK_CHARS, `tool block is ${json.length} chars`);
  assert.ok(estimateTokens(json) <= MAX_TOOL_BLOCK_TOKENS, `tool block is ${estimateTokens(json)} estimated tokens`);
  const names = offered.map((tool) => tool.name);
  assert.ok(names.includes("ae_tool_schema") && names.includes("ae_call_tool"));
  assert.deepEqual(names.filter((name) => !CORE_TOOLS.has(name)), ["ae_tool_schema", "ae_call_tool"], "everything else is core");
  const catalogue = offered.find((tool) => tool.name === "ae_tool_schema")?.description ?? "";
  for (const longTail of ["ae_query_relational_graph", "ae_solve_arc_path", "ae_offer_variants", "ae_search_fonts", "ae_trace_dependencies", "ae_get_project_overview", "ae_status", "ae_refresh_snapshot"]) assert.match(catalogue, new RegExp(`\\b${longTail}\\b`), `${longTail} is listed by name`);
  assert.ok(catalogue.length < 1_300, `the catalogue is names only (${catalogue.length} chars): details come from asking for one tool`);
});

test("ae_measure_layer is offered directly: the briefing sends every geometry question to it, so a schema lookup or a guessed call is a wasted step", () => {
  const offered = toolSurface(agentToolSpecs(STANDARD_TURN)).offered;
  const spec = offered.find((tool) => tool.name === "ae_measure_layer");
  assert.ok(spec, "measure is in the core block");
  assert.ok(JSON.stringify(spec.parameters).includes("compositionId"), "its full schema is offered, not a catalogue line");
});

test("the tools array is byte-identical on every step of a turn", async () => {
  const provider = new MockProvider({ script: (input) => {
    const steps = input.messages.filter((message) => message.role === "assistant").length;
    if (steps === 0) return { text: "", toolCalls: [{ id: "s1", name: "ae_tool_schema", arguments: { name: "ae_trace_dependencies" } }] };
    if (steps === 1) return { text: "", toolCalls: [trace] };
    if (steps === 2) return { text: "", toolCalls: [{ id: "i1", name: "ae_inspect_layer", arguments: { compositionId: "comp-1", layerId: "layer-1" } }] };
    return { text: "Done.", toolCalls: [] };
  } });
  await runAgent(provider, { requestId: "req-stable-tools", message: "trace it", history: [], briefing: "b", ...STANDARD_TURN, callTool: () => ok() });
  assert.equal(provider.stepInputs.length, 4);
  const first = JSON.stringify(provider.stepInputs[0]?.tools);
  assert.ok(first.length > 2);
  for (const input of provider.stepInputs) assert.equal(JSON.stringify(input.tools), first);
});

test("ae_tool_schema returns a long-tail tool's full schema and ae_call_tool runs it under the inner name", async () => {
  const dispatched: string[] = [];
  const logged: AgentLogLine[] = [];
  const progress: string[] = [];
  const provider = new MockProvider({ script: (input) => {
    const steps = input.messages.filter((message) => message.role === "assistant").length;
    if (steps === 0) return { text: "", toolCalls: [{ id: "s1", name: "ae_tool_schema", arguments: { name: "ae_trace_dependencies" } }] };
    if (steps === 1) return { text: "", toolCalls: [trace] };
    return { text: "Traced.", toolCalls: [] };
  } });
  const result = await runAgent(provider, {
    requestId: "req-dispatch", message: "trace it", history: [], briefing: "b",
    callTool: (name) => { dispatched.push(name); return ok({ bounds: [0, 0, 10, 10] }); },
    log: (line) => logged.push(line),
    onProgress: (event) => { if (event.tool) progress.push(event.tool); },
  });
  const schema = provider.stepInputs[1]?.messages.find((message) => message.role === "tool");
  assert.ok(schema?.content.includes("compositionId") && schema.content.includes('"parameters"'), "the schema result carries the real parameters");
  assert.deepEqual(dispatched, ["ae_trace_dependencies"], "the host path sees the inner tool, never the dispatcher");
  assert.deepEqual(result.tools.map((tool) => tool.name), ["ae_tool_schema", "ae_trace_dependencies"]);
  assert.deepEqual(logged.flatMap((line) => line.event === "agent.tool" ? [line.tool] : []), ["ae_tool_schema", "ae_trace_dependencies"]);
  assert.ok(progress.includes("ae_trace_dependencies") && !progress.includes("ae_call_tool"));
  const toolMessages = provider.stepInputs[2]?.messages.filter((message) => message.role === "tool").map((message) => message.name);
  assert.deepEqual(toolMessages, ["ae_tool_schema", "ae_trace_dependencies"]);
});

test("a queue tool called through the dispatcher is admission-logged under its own name", async () => {
  const logged: AgentLogLine[] = [];
  const provider = new MockProvider({ script: (input) => input.messages.some((message) => message.role === "tool")
    ? { text: "Rejected.", toolCalls: [] }
    : { text: "", toolCalls: [{ id: "q1", name: "ae_call_tool", arguments: { name: "ae_queue_add", arguments: { summary: "x", operations: [{ type: "set_layer_name" }] } } }] } });
  await runAgent(provider, { requestId: "req-admission", message: "rename", history: [], briefing: "b", callTool: () => ({ ok: false, error: { code: "AMBIGUOUS_COMPOSITION", message: "which comp?" } }), log: (line) => logged.push(line) });
  const rejected = logged.find((line): line is AgentAdmissionLogLine => line.event === "agent.admission_rejected");
  assert.equal(rejected?.tool, "ae_queue_add");
  assert.deepEqual(rejected?.operationTypes, ["set_layer_name"]);
});

async function wrongCall(call: AgentToolCall): Promise<{ dispatched: string[]; content: string; tools: Array<{ name: string; code?: string | undefined }> }> {
  const dispatched: string[] = [];
  const provider = new MockProvider({ script: (input) => input.messages.some((message) => message.role === "tool") ? { text: "Stopped.", toolCalls: [] } : { text: "", toolCalls: [call] } });
  const result = await runAgent(provider, { requestId: "req-invalid", message: "measure", history: [], briefing: "b", callTool: (name) => { dispatched.push(name); return ok(); } });
  const answered = provider.stepInputs[1]?.messages.find((message) => message.role === "tool");
  return { dispatched, content: answered?.content ?? "", tools: result.tools };
}

test("invalid arguments return the schema so the model can fix the call in one step", async () => {
  const { dispatched, content, tools } = await wrongCall({ id: "bad", name: "ae_call_tool", arguments: { name: "ae_write_effect_note", arguments: { matchName: 7, expectedNoteIds: [] } } });
  assert.deepEqual(dispatched, [], "an invalid call never reaches the tool");
  assert.match(content, /arguments\.text is required/);
  assert.match(content, /arguments\.matchName must be string/);
  assert.match(content, /parameters.{1,3}:\{.{1,3}type.{1,3}:.{1,3}object/, "the schema rides in the error");
  assert.deepEqual(tools.map((tool) => [tool.name, tool.code]), [["ae_write_effect_note", "INVALID_TOOL_ARGUMENTS"]]);
});

test("an unknown tool name is refused and logged under that name", async () => {
  const { dispatched, content, tools } = await wrongCall({ id: "none", name: "ae_call_tool", arguments: { name: "ae_not_a_tool", arguments: {} } });
  assert.deepEqual(dispatched, []);
  assert.match(content, /ae_not_a_tool is not a tool available this turn/);
  assert.match(content, /Available: /);
  assert.deepEqual(tools.map((tool) => [tool.name, tool.code]), [["ae_not_a_tool", "TOOL_NOT_AVAILABLE"]]);
});

test("calling a long-tail tool directly by name still works, and a bad direct call is answered with the schema", async () => {
  const dispatched: string[] = [];
  const provider = new MockProvider({ script: (input) => {
    const steps = input.messages.filter((message) => message.role === "assistant").length;
    if (steps === 0) return { text: "", toolCalls: [{ id: "d1", name: "ae_read_effect_notes", arguments: { matchName: "ADBE Glo2" } }, { id: "d2", name: "ae_read_effect_notes", arguments: {} }] };
    return { text: "Done.", toolCalls: [] };
  } });
  const result = await runAgent(provider, { requestId: "req-direct", message: "measure", history: [], briefing: "b", callTool: (name) => { dispatched.push(name); return ok(); } });
  assert.deepEqual(dispatched, ["ae_read_effect_notes"]);
  assert.deepEqual(result.tools.map((tool) => tool.ok), [true, false]);
});

test("a restricted turn offers its allowed tools directly and refuses everything else", async () => {
  const provider = new MockProvider({ script: (input) => input.messages.some((message) => message.role === "tool") ? { text: "No.", toolCalls: [] } : { text: "", toolCalls: [{ id: "x", name: "ae_call_tool", arguments: { name: "ae_queue_add", arguments: {} } }, { id: "y", name: "ae_measure_layer", arguments: { compositionId: "c", layerId: "l" } }] } });
  const dispatched: string[] = [];
  await runAgent(provider, { requestId: "req-restricted", message: "look", history: [], briefing: "b", allowedTools: ["ae_get_selection"], callTool: (name) => { dispatched.push(name); return ok(); } });
  assert.deepEqual(provider.stepInputs[0]?.tools?.map((tool) => tool.name), ["ae_get_selection"]);
  assert.deepEqual(dispatched, []);
});

test("the external MCP tool list is exactly what it was", () => {
  assert.equal(createHash("sha256").update(canonicalJson(listTools())).digest("hex"), EXTERNAL_SURFACE_SHA256);
  const names = new Set(listTools().map((tool) => tool.name));
  assert.ok(!names.has("ae_tool_schema") && !names.has("ae_call_tool"), "the dispatcher is in-panel only");
  const inPanel = agentToolSpecs(STANDARD_TURN).find((tool) => tool.name === "ae_queue_add");
  assert.equal(inPanel?.description, listTools().find((tool) => tool.name === "ae_queue_add")?.description);
});

test("the in-panel ae_measure_layer says both ids are required id strings, and the external description is untouched", () => {
  const inPanel = agentToolSpecs(STANDARD_TURN).find((tool) => tool.name === "ae_measure_layer");
  const external = listTools().find((tool) => tool.name === "ae_measure_layer");
  assert.match(inPanel?.description ?? "", /both compositionId .* and layerId .*never a layer number or name/);
  assert.doesNotMatch(external?.description ?? "", /never a layer number/);
  assert.deepEqual(inPanel?.parameters.required, ["compositionId", "layerId"]);
});

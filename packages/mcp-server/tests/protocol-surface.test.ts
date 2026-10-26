// Proves the MCP surface: which tools are declared and how, the stateless adapter and stdio launcher, the hints agents are given, the panel's reasoning surface, and the operation limit.
import test from "node:test";
import assert from "node:assert/strict";
import { array, boolean, number, object, optional, string } from "@extynt/decode";
import { representativeSnapshot } from "@extynt/project-graph";
import { BASE_CATALOGUE } from "@extynt/capability-catalogue";
import { agentToolDefinitions, callTool, handleMcpRequest, listTools, PROPOSAL_OPERATION_LIMIT, TOOL_DEFINITIONS } from "../src/index.js";
import type { StoredPlan } from "../src/index.js";
import { arrayAt, integerAt, objectAt, stringAt } from "../src/json.js";
import type { JsonObject } from "@extynt/decode";
import { hostSource, repoFile } from "./support/fixtures.js";
import { payloadOf, refusalOf } from "./support/json-results.js";
import { baseLayer, framesOf, propertyOf, runStdio, successOf, successView, toolNamed } from "./support/protocol-views.js";

const HINT = /call (ae_[a-z_]+)(?: with ([A-Za-z]+))?/g;

test("declares bounded read-only tools", () => {
  assert.ok(listTools().some((tool) => tool.name === "ae_search_capabilities"));
  assert.equal(listTools()[0]?.inputSchema.additionalProperties, false);
});

test("capability search returns snapshot identity and does not mutate", () => {
  const snapshot = representativeSnapshot;
  const result = callTool("ae_search_capabilities", { query: "blur" }, { snapshot, catalogue: BASE_CATALOGUE });
  assert.equal(successOf(result).snapshotFingerprint, snapshot.fingerprint);
  const rows = successView(array(object({ matchName: optional(string()) })), result);
  assert.equal(rows[0]?.matchName, "ADBE Gaussian Blur 2");
});

test("natural-language intent compilation is not a tool: a plan is written, not guessed from a sentence", () => {
  const names = listTools("agent").map((tool) => tool.name);
  assert.equal(names.includes("ae_compile_intent"), false);
  assert.equal(names.includes("ae_list_recipes"), false);
  assert.equal(callTool("ae_compile_intent", { request: "fade the selected layer in over 2 seconds" }, { snapshot: representativeSnapshot }).ok, false);
});

test("unknown and mutation-shaped tools are rejected", () => {
  const snapshot = representativeSnapshot;
  assert.equal(callTool("ae_execute", {}, { snapshot }).ok, false);
  assert.equal(callTool("ae_status", {}, {}).ok, false);
});

test("native frame request is read-only, exact-time, and bounded to the observed composition", () => {
  const frameRequest = object({ request: object({ width: number(), height: number(), time: number(), shareWithProvider: boolean() }), maxEncodedBytes: number() });
  const result = callTool("ae_capture_composition_frame", { compositionId: "comp-main", time: 1, maxEncodedBytes: 65536 }, { snapshot: representativeSnapshot });
  assert.deepEqual(successView(frameRequest, result), { request: { width: 1920, height: 1080, time: 1, shareWithProvider: false }, maxEncodedBytes: 65536 });
  const outOfRange = callTool("ae_capture_composition_frame", { compositionId: "comp-main", time: 999 }, { snapshot: representativeSnapshot });
  assert.equal(outOfRange.ok, false);
});

test("frame capture and numeric observation stay separate from structural verification", () => {
  const capture = toolNamed(listTools(), "ae_capture_composition_frame");
  const observe = toolNamed(listTools(), "ae_observe_frame");
  assert.equal(capture.annotations.readOnlyHint, true);
  assert.equal(observe.annotations.readOnlyHint, true);
  assert.match(capture.description, /never uploaded/);
  assert.match(observe.description, /Measure a capture in numbers instead of pixels/);
  assert.match(observe.description, /compare two times/);
  assert.doesNotMatch(observe.description, /verified|success|passed/);
});

test("JSON-RPC MCP adapter remains stateless", () => {
  const response = handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }, {});
  assert.equal((arrayAt(objectAt(response, "result"), "tools")?.length ?? 0) > 10, true);
});

test("stdio ignores notifications without desynchronizing the next request", async () => {
  const run = await runStdio([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  ]);
  assert.equal(run.exitCode, 0, run.stderr);
  const responses = framesOf(run);
  assert.equal(responses.length, 2);
  assert.deepEqual(responses.map((response) => response.id), [1, 2]);
  assert.ok(responses[1]?.result);
});

test("ae_recall_plan is advertised as a read-only plan tool, because recall is what makes a delta cheap", () => {
  const definition = toolNamed(listTools(), "ae_recall_plan");
  assert.equal(definition.annotations.readOnlyHint, true, "recall changes nothing");
  assert.ok(listTools("agent").some((entry) => entry.name === "ae_recall_plan"), "and the agent can call it");
  assert.deepEqual(definition.inputSchema.required, ["planId"]);
  assert.ok(propertyOf(definition, "cursor"), "the continuation is an argument the model can pass back");
  assert.match(definition.description, /0-based indexing ae_amend_plan edits/, "the description says an index here is amend's index");
});

test("agent-facing hints only reference advertised tools and arguments their schemas accept", () => {
  const sources = ["apps/sidecar/src/server.ts", "packages/mcp-server/src/index.ts"].map((path) => repoFile(path)).join("\n");
  const agentTools = new Map(listTools("agent").map((definition) => [definition.name, definition]));
  for (const [, tool = "", argument] of sources.matchAll(HINT)) {
    const definition = agentTools.get(tool);
    assert.ok(definition, `hint references unadvertised tool ${tool}`);
    if (argument) assert.ok(propertyOf(definition, argument), `${tool} schema lacks ${argument}`);
  }
});

test("the panel has one expandable live reasoning surface and no legacy reasoning chain", () => {
  const source = repoFile("apps/panel/main.js");
  const markup = repoFile("apps/panel/index.html");
  assert.match(markup, /id="status-bar"[^>]*role="status"/);
  assert.match(source, /byId\("status-bar"\)/);
  assert.match(source, /aria-expanded/);
  assert.doesNotMatch(source, /CHAIN_TOOL_KINDS|CHAIN_KIND|reasoningChain|extyntShowThinking|showThinkingEnabled/);
  assert.doesNotMatch(markup, /Show the model(?:'s|&apos;) thinking|show-thinking/);
});

function markers(count: number): JsonObject[] {
  const { composition, layer } = baseLayer();
  const target = { compositionId: composition.id, layerId: layer.id };
  return Array.from({ length: count }, (_, index) => ({ type: "add_marker", target, time: index * 0.1, comment: `m${index}` }));
}

function advertisedLimit(): number {
  const limit = integerAt(propertyOf(toolNamed(listTools("agent"), "ae_propose_plan"), "operations"), "maxItems");
  assert.ok(limit !== undefined, "the schema advertises a maximum");
  return limit;
}

function assertMailboxBoundMatches(): void {
  const mailbox = hostSource();
  const bound = /var (AE_MAX_PLAN_OPERATIONS) = (\d+);/.exec(mailbox);
  assert.ok(bound, "the mailbox's apply_plan bound is a named constant this test can read");
  const [, constant = "", value = ""] = bound;
  assert.equal(Number(value), PROPOSAL_OPERATION_LIMIT, "the mailbox must apply every plan the schema can advertise");
  assert.match(mailbox, new RegExp(`operations\\.length <= ${constant};`), "and it must read that constant rather than a literal free to drift again");
  assert.match(mailbox, new RegExp(`\\+ ${constant} \\+`), "as must the refusal, which names the bound it enforced");
}

test("the advertised operation limit and the enforced one are the same number", () => {
  const advertised = advertisedLimit();
  assert.equal(advertised, PROPOSAL_OPERATION_LIMIT);
  const atLimit = callTool("ae_propose_plan", { summary: `${advertised} markers`, operations: markers(advertised) }, { snapshot: representativeSnapshot, plans: new Map() });
  assert.equal(atLimit.ok, true, JSON.stringify(atLimit).slice(0, 240));
  const overLimit = callTool("ae_propose_plan", { summary: "one too many", operations: markers(advertised + 1) }, { snapshot: representativeSnapshot, plans: new Map() });
  const refusal = refusalOf(overLimit);
  assert.equal(refusal.code, "INVALID_ARGUMENT");
  assert.match(refusal.message, new RegExp(`1–${advertised} entries`));
  assertMailboxBoundMatches();
});

test("ae_cancel_plan and ae_present_plan are annotated as mutations", () => {
  for (const name of ["ae_cancel_plan", "ae_present_plan"]) {
    const annotations = toolNamed(listTools(), name).annotations;
    assert.equal(annotations.readOnlyHint, undefined, `${name} must not claim readOnlyHint`);
    assert.equal(annotations.destructiveHint, true, `${name} rewrites stored plan state`);
  }
  const context = { snapshot: representativeSnapshot, catalogue: BASE_CATALOGUE, panelSessionId: "panel-test", plans: new Map<string, StoredPlan>() };
  const planId = stringAt(payloadOf(callTool("ae_prepare_change", {}, context)), "planId");
  assert.ok(planId, "a prepared change names its plan");
  assert.equal(callTool("ae_present_plan", { planId }, context).ok, true);
  assert.equal(context.plans.get(planId)?.status, "presented", "presenting really does rewrite the stored status");
  assert.equal(callTool("ae_cancel_plan", { planId }, context).ok, true);
  assert.equal(context.plans.get(planId)?.status, "cancelled", "cancelling really does rewrite the stored status");
});

test("the queue agent's tool surface is one generation of the API, and the ceiling is not a budget", () => {
  const offered = agentToolDefinitions().map((definition) => definition.name);
  for (const kept of ["ae_queue_add", "ae_queue_fix", "ae_queue_finish", "ae_recall_plan", "ae_undo_agent_work", "ae_inspect_layer", "ae_search_host_capabilities", "ae_status", "ae_refresh_snapshot"]) {
    assert.ok(offered.includes(kept), `${kept} is part of the queue agent's surface`);
  }
  for (const retired of ["ae_propose_plan", "ae_plan_create", "ae_plan_add", "ae_plan_complete", "ae_amend_plan", "ae_get_plan_status", "ae_approve_plan", "ae_cancel_plan", "ae_get_receipt", "ae_undo_plan", "ae_present_plan", "ae_list_plans", "ae_prepare_change"]) {
    assert.equal(offered.includes(retired), false, `${retired} belongs to the contract where the caller owns a plan id`);
  }
  for (const callable of ["ae_plan_create", "ae_plan_add", "ae_plan_complete", "ae_approve_plan", "ae_undo_plan", "ae_get_receipt"]) {
    assert.ok(TOOL_DEFINITIONS.some((definition) => definition.name === callable), `${callable} stays callable`);
  }
  const queueAdd = toolNamed(TOOL_DEFINITIONS, "ae_queue_add");
  assert.equal(propertyOf(queueAdd, "operations")?.maxItems, undefined, "the per-call ceiling is enforced, not advertised");
  assert.doesNotMatch(queueAdd.description, /\b25\b/, "and the description never names it");
});

test("the declared tools only the sidecar answers are refused as UNSUPPORTED_TOOL, not answered with an inventory", () => {
  const sidecarOnly = ["ae_query_relational_graph", "ae_describe_control", "ae_prepare_parameter_change", "ae_read_effect_notes", "ae_write_effect_note", "ae_query_graph_cache", "ae_read_graph_page", "ae_get_graph_page", "ae_check_request"];
  for (const name of sidecarOnly) {
    assert.ok(TOOL_DEFINITIONS.some((definition) => definition.name === name), `${name} is declared`);
    assert.equal(refusalOf(callTool(name, {}, { snapshot: representativeSnapshot })).code, "UNSUPPORTED_TOOL", name);
  }
});

test("a capture size that is not a whole number is ignored for the default, one out of range is refused", () => {
  const fractional = callTool("ae_capture_composition_frame", { compositionId: "comp-main", time: 1, previewMaxWidth: 100.5, maxEncodedBytes: 70000.5 }, { snapshot: representativeSnapshot });
  assert.equal(fractional.ok, true);
  const small = callTool("ae_capture_composition_frame", { compositionId: "comp-main", time: 1, previewMaxWidth: 8 }, { snapshot: representativeSnapshot });
  assert.equal(refusalOf(small).code, "INVALID_ARGUMENT");
});

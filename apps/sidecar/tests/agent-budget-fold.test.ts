/**
 * Prompt budget and folding: what the model's window buys, and which tool output is shed when a turn reads too much.
 * The measured runs are a model that inspects a layer every step for 24 steps, each result about 9k characters, measured as the request is sent because the provider keeps a reference to the live message list that later folds shrink.
 * A continuation cycle's system prompt carries the contract, the receipts and the specialist handoff: over 20k tokens before any message.
 */
import { promptTokens } from "../src/agent-fold.js";
import { MIN_MESSAGE_WORKING_TOKENS } from "../src/agent-policy.js";
import { AGENT_VISION_TOOLS, FOLD_REREAD_TOOLS, agentToolSpecs, type ToolArguments, foldOldToolResults, runAgent, identityDigest, toolResultBudgetTokens, turnBudget, wrapUpSteps } from "../src/agent.js";
import { resolveSlot, type ResolvedSlot } from "../src/llm-slot-resolution.js";
import type { ModelSlot } from "../src/llm-model-services.js";
import { assistantAt, present, toolAt } from "./agent-test-support.js";
import { authorization, chatTurn, mutableSnapshot, sidecarFor, token } from "./sidecar-fixture.js";
import { array, decode, object, string } from "@extynt/decode";
import { MockProvider, type AgentMessage } from "@extynt/llm";
import { agentToolDefinitions, planCardTools } from "@extynt/mcp-server";
import assert from "node:assert/strict";
import test from "node:test";

function slotFor(env: Record<string, string>, slot: ModelSlot = "primary"): ResolvedSlot {
  const resolved = resolveSlot({ file: {}, dotEnv: {}, process: env }, slot);
  assert.ok(resolved, "the slot resolves for a declared provider");
  return resolved;
}

test("a turn that reads far more than the model can hold folds its oldest tool output instead of overrunning", async (t) => {

  const big = "x".repeat(13_000);
  let steps = 0;
  const provider = new MockProvider({ script: (input) => {
    steps += 1;
    const carried = input.messages.filter((message) => message.role === "tool").reduce((sum, message) => sum + message.content.length, 0);
    if (steps > 12) return { text: `carried ${carried}`, toolCalls: [] };
    return { text: "", toolCalls: [{ id: `c${steps}`, name: "ae_get_project_overview", arguments: { note: big } }] };
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-fold")) });
  const response = await chatTurn(address, "read everything");
  const carried = Number(/carried (\d+)/.exec(response.answer)?.[1] ?? "0");

  const budget = toolResultBudgetTokens(undefined, undefined);
  assert.ok(carried > 0, "the model must still see tool output");
  assert.ok(carried < budget * 3.6 * 1.2, `carried ${carried} chars, which is past the fold budget ${budget}`);
});

test("the tool budget comes from the model's window and the thinking it was asked for", () => {

  const millionWindow = toolResultBudgetTokens(1_000_000, "high");
  assert.ok(millionWindow > 900_000, `a 1M window with default thinking should carry most of it, got ${millionWindow}`);
  assert.ok(toolResultBudgetTokens(1_000_000, "max") < millionWindow, "more thinking leaves less room for tool output");
  assert.ok(toolResultBudgetTokens(1_000_000, undefined) === toolResultBudgetTokens(1_000_000, "high"), "an unset effort reserves the provider default (high), not nothing");
  const undeclared = toolResultBudgetTokens(undefined, undefined);
  assert.ok(undeclared < millionWindow, "an undeclared window must not be treated as a large one");
  assert.equal(toolResultBudgetTokens(8_000, "max"), 16_000, "a window too small to hold the reserves floors instead of going negative");

  assert.equal(wrapUpSteps(8), 4, "a backstop too short to warn proportionally keeps the floor");
  assert.equal(wrapUpSteps(20), 7, "a longer one warns on its share");
  assert.ok(wrapUpSteps(60) >= 18, `a long backstop warns with real room left, got ${wrapUpSteps(60)}`);
  assert.ok(wrapUpSteps(60) < 60 * 0.5, `and not so early that the warning is noise, got ${wrapUpSteps(60)}`);
});

test("the per-result cap and the fold size are shares of the budget, not second absolutes", () => {

  const big = turnBudget(1_000_000, "high");
  const small = turnBudget(128_000, "high");
  assert.ok(big.toolTokens > small.toolTokens);
  assert.ok(big.perResultChars > small.perResultChars, "a larger budget affords a larger single result");
  assert.ok(small.perResultChars < small.toolTokens * small.charsPerToken, "one result can never be the whole budget");
  assert.ok(big.foldedChars > small.foldedChars, "a folded result keeps more when there is more room");

  const dense = turnBudget(1_000_000, "high", 2);
  assert.ok(dense.perResultChars < big.perResultChars, "fewer characters per token means a smaller character cap");
  assert.equal(dense.toolTokens, big.toolTokens, "the token budget itself does not depend on the ratio");

  assert.ok(big.historyTokens + big.briefingTokens <= big.promptTokens);
});

test("the fold sheds the oldest tool output first, keeps its identities, and leaves the newest result whole", () => {

  const budget = 100_000;
  const messages: AgentMessage[] = [];
  for (let index = 0; index < 40; index += 1) messages.push({ role: "tool", toolCallId: `call-${index}`, name: "ae_inspect_layer", content: JSON.stringify({ layerId: `layer-${index}`, pad: "x".repeat(60_000) }) });
  messages.push({ role: "tool", toolCallId: "call-newest", name: "ae_inspect_layer", content: JSON.stringify({ layerId: "layer-newest", pad: "y".repeat(1_000) }) });
  foldOldToolResults(messages, budget);
  const carried = messages.filter((message) => message.role === "tool").reduce((sum, message) => sum + message.content.length, 0);
  assert.ok(carried <= budget * 3.6 * 1.2, `the folded turn still carries ${carried} chars`);
  const oldest = messages[0];
  assert.ok(oldest?.role === "tool" && oldest.content.includes("[earlier result folded to save room."), "the oldest result folds first");
  assert.ok(oldest?.role === "tool" && oldest.content.includes("layerId=layer-0"), "the fold keeps the identities the result named");
  const newest = messages.at(-1);
  assert.ok(newest?.role === "tool" && newest.content.includes("layer-newest"), "the newest result is left whole");
});

test("a fold leaves a refusal's fix list and a checkpoint's outstanding entries whole", () => {

  const fixes = Array.from({ length: 10 }, (_, index) => ({
    position: 6 + index * 4,
    type: index % 2 ? "set_effect_control" : "ensure_effect",
    code: index % 2 ? "TARGET_NOT_FOUND" : "INVALID_TARGET",
    message: index % 2
      ? "The exact effect control path is not present in the current snapshot or an earlier ensure_effect operation."
      : "The target effectPath must equal the operation's resolved effectPath.",
    instruction: index % 2
      ? "Re-read what is in the project (ae_inspect_composition) and target an id that exists; a layer created in an earlier batch is addressed by the id its verdict reported."
      : "Correct the target fields named in the message; a composition or layer id that is not in the current snapshot, or the wrong effect, cannot be applied.",
  }));
  const refusal = JSON.stringify({
    snapshotFingerprint: "db1f9705",
    data: { queued: 0, accepted: 0, fix: fixes, next: `Nothing was queued from that call, so the queue still holds 0 operations. Correct the ${fixes.length} operations named above — position ${fixes.map((entry) => entry.position).join(", ")} of that call — and send them again with ae_queue_add.` },
  });
  const checkpoint = JSON.stringify({
    snapshotFingerprint: "db1f9705",
    data: { queued: 40, accepted: 12, checkpoint: { reviewed: 36, queued: 40, outstanding: fixes.map((entry, index) => ({ index, type: entry.type, code: entry.code, message: entry.message, instruction: entry.instruction })) } },
  });
  const messages: AgentMessage[] = [
    { role: "tool", toolCallId: "call-refused", name: "ae_queue_add", content: refusal },
    { role: "tool", toolCallId: "call-checkpoint", name: "ae_queue_add", content: checkpoint },
    { role: "tool", toolCallId: "call-plain", name: "ae_inspect_composition", content: JSON.stringify({ pad: "x".repeat(40_000) }) },
  ];
  foldOldToolResults(messages, 2_000);
  assert.ok(toolAt(messages, 2).content.includes("[earlier result folded to save room."), "the fold ran: the ordinary result after them is folded");
  assert.equal(toolAt(messages, 0).content, refusal, "every fix entry survives verbatim, whatever head the budget derives");
  assert.equal(toolAt(messages, 1).content, checkpoint, "a checkpoint's outstanding entries survive the same way");
  assert.equal((toolAt(messages, 0).content.match(/"position":/g) ?? []).length, fixes.length, "the refusal still carries all ten positions");
  assert.equal((toolAt(messages, 0).content.match(/"instruction":/g) ?? []).length, fixes.length, "and all ten instructions");
  for (const entry of fixes) {
    assert.ok(toolAt(messages, 0).content.includes(`"position":${entry.position}`), `position ${entry.position} is present`);
    assert.ok(toolAt(messages, 0).content.includes(JSON.stringify(entry.instruction)), `the instruction for position ${entry.position} is present`);
  }
  assert.equal((toolAt(messages, 1).content.match(/"index":/g) ?? []).length, fixes.length, "the checkpoint's entries are all there too");

  const nested: AgentMessage[] = [{ role: "tool", toolCallId: "call-nested", name: "ae_queue_finish", content: JSON.stringify({ result: { body: { data: { outstanding: fixes } } }, pad: "x".repeat(40_000) }) }];
  foldOldToolResults(nested, 1_000);
  assert.equal((toolAt(nested, 0).content.match(/"position":/g) ?? []).length, fixes.length, "a payload nested differently is recognised by shape, not by where it sits");
});

test("a fold names a read-only tool as the way back and never a mutating one", () => {

  const mutating = ["ae_propose_plan", "ae_queue_add", "ae_queue_fix", "ae_queue_finish", "ae_plan_create", "ae_plan_add", "ae_plan_complete", "ae_amend_plan", "ae_present_plan", "ae_approve_plan", "ae_cancel_plan", "ae_undo_plan", "ae_undo_agent_work", "ae_apply_batch"];
  const messages: AgentMessage[] = mutating.map((name, index) => ({ role: "tool", toolCallId: `call-${index}`, name, content: JSON.stringify({ queued: index, pad: "x".repeat(20_000) }) }));
  messages.push({ role: "tool", toolCallId: "call-read", name: "ae_inspect_layer", content: JSON.stringify({ layerId: "layer-0", pad: "x".repeat(20_000) }) });
  foldOldToolResults(messages, 1_000);
  for (const [index, name] of mutating.entries()) {
    const folded = toolAt(messages, index).content;
    assert.ok(folded.includes("[earlier result folded to save room."), `${name} still gives up its bulk`);
    assert.ok(!folded.includes("again if you need the rest"), `the fold never tells the model to call ${name} again`);
    assert.ok(!folded.includes(name), `${name} does not appear in its own folded result`);
  }
  assert.ok(toolAt(messages, messages.length - 1).content.includes("Call ae_inspect_layer again if you need the rest"), "a read-only tool is still named as the honest way to read the result again");
});

test("the tools a fold may name are reads in the server's tool table, and never a plan tool", () => {

  const table = new Set(agentToolDefinitions().map((definition) => definition.name));
  const plan = new Set(planCardTools().map((definition) => definition.name));
  const textOnly = new Set(agentToolSpecs({ acceptsImages: false, webSearch: false }).map((definition) => definition.name));
  const withImages = new Set(agentToolSpecs({ acceptsImages: true, webSearch: false }).map((definition) => definition.name));
  assert.ok(FOLD_REREAD_TOOLS.size > 20, `the read surface is not empty, got ${FOLD_REREAD_TOOLS.size}`);
  for (const name of FOLD_REREAD_TOOLS) {
    assert.ok(table.has(name), `${name} is a tool in the server's table`);
    assert.ok(!plan.has(name), `${name} is not one of the authoring tools whose result is stored work`);
  }
  for (const name of AGENT_VISION_TOOLS) {
    assert.ok(FOLD_REREAD_TOOLS.has(name), `${name} is read-only and is in the table`);
    assert.ok(table.has(name) && withImages.has(name), `${name} is offered once the model accepts images`);
    assert.ok(!textOnly.has(name), `${name} is not on a text-only run's surface, so such a run is never told to call it again`);
    assert.ok(!plan.has(name), `${name} is not a plan tool either`);
  }
  for (const name of ["ae_status", "ae_inspect_layer", "ae_inspect_composition", "ae_get_project_overview", "ae_observe_frame"]) assert.ok(FOLD_REREAD_TOOLS.has(name), `${name} may be named`);

  assert.ok(FOLD_REREAD_TOOLS.has("ae_recall_plan"), "a paged plan recall may name itself to continue exact source-plan reading");
  for (const name of ["ae_list_plans", "ae_get_plan_status", "ae_get_receipt", "ae_prepare_change", "ae_get_fresh_edit_context", "ae_present_plan", "ae_queue_add", "ae_undo_agent_work"]) assert.ok(!FOLD_REREAD_TOOLS.has(name), `${name} is never named as a way to read a result again`);
});

test("the actionable-entry check reads the shape, not the spelling", () => {
  const entry = { position: 2, type: "create_shape_group", code: "UNKNOWN_FIELD", message: "Unknown field: groupId at the top level.", instruction: "Drop the top-level groupId; the id belongs inside target." };
  const body = (value: string) => `{"snapshotFingerprint":"db1f9705","data":{"queued":0,${value},"next":"Correct it and send it again."}}`;
  const cases: Array<[string, string, boolean]> = [
    ["an object as the first entry", body(`"fix":[${JSON.stringify(entry)}]`), true],
    ["a note before the entries", body(`"fix":["see below",${JSON.stringify(entry)}]`), true],
    ["the entries nested one array deeper", body(`"fix":[[${JSON.stringify(entry)}]]`), true],
    ["an empty array", body(`"fix":[]`), false],
    ["no object in the array at all", body(`"fix":["nothing to fix"]`), false],
    ["the shape quoted inside a string value", body(`"note":"\\"fix\\": [{\\"position\\": 2}]"`), false],
  ];
  for (const [label, content, actionable] of cases) {
    const padded = `${content}${" ".repeat(20_000)}`;
    const messages: AgentMessage[] = [
      { role: "tool", toolCallId: "call-case", name: "ae_queue_add", content: padded },
      { role: "tool", toolCallId: "call-pad", name: "ae_inspect_composition", content: JSON.stringify({ pad: "x".repeat(40_000) }) },
    ];
    foldOldToolResults(messages, 1_000);
    assert.ok(toolAt(messages, 1).content.includes("[earlier result folded to save room."), `${label}: the pass really ran`);
    assert.equal(toolAt(messages, 0).content === padded, actionable, `${label}: ${actionable ? "kept whole" : "folded away"}`);
  }
});

test("the last-resort pass still leaves a refusal's entries whole", () => {
  const fixes = Array.from({ length: 10 }, (_, index) => ({ position: 6 + index * 4, type: "ensure_effect", code: "INVALID_TARGET", message: `Operation ${6 + index * 4} does not resolve.`, instruction: `Fix ${index}: correct the target fields named in the message.` }));
  const refusal = JSON.stringify({ snapshotFingerprint: "db1f9705", data: { queued: 0, accepted: 0, fix: fixes } });
  const messages: AgentMessage[] = [
    { role: "assistant", content: "", toolCalls: [{ id: "call-refused", name: "ae_queue_add", arguments: { operations: [{ type: "create_layer", pad: "p".repeat(6_000) }] } }] },
    { role: "tool", toolCallId: "call-refused", name: "ae_queue_add", content: refusal },

    { role: "tool", toolCallId: "call-plain-1", name: "ae_inspect_composition", content: JSON.stringify({ pad: "x".repeat(40_000) }) },
    { role: "tool", toolCallId: "call-plain-2", name: "ae_inspect_composition", content: JSON.stringify({ pad: "x".repeat(40_000) }) },
    { role: "tool", toolCallId: "call-plain-3", name: "ae_inspect_composition", content: JSON.stringify({ pad: "x".repeat(40_000) }) },
  ];

  foldOldToolResults(messages, 16_000, { foldedChars: 400, charsPerToken: 3.6, lastResort: true });
  assert.ok(toolAt(messages, 2).content.includes("[earlier result folded to save room."), "the pass really ran: the ordinary results are folded");
  assert.equal(toolAt(messages, 1).content, refusal, "the refusal is untouched even by the pass that may re-cut folded results");
  assert.equal((toolAt(messages, 1).content.match(/"position":/g) ?? []).length, fixes.length, "and every entry is still there");
});

test("a folded or truncated tool result keeps the identities it named", () => {

  const body = JSON.stringify({ compositions: [{ id: "comp-main", name: "Main", layers: [{ id: "layer-title", name: "Title", index: 1, effects: [{ matchName: "ADBE Gaussian Blur 2" }] }, { id: "layer-footage", name: "Footage", index: 2 }] }] });
  const digest = identityDigest(body);
  for (const identity of ["id=comp-main", "id=layer-title", "id=layer-footage", "matchName=ADBE Gaussian Blur 2"]) assert.ok(digest.includes(identity), `${identity} survives the fold`);

  assert.ok(identityDigest(body.slice(Math.floor(body.length / 2))).includes("id=layer-footage"));

  assert.equal(identityDigest(JSON.stringify({ opacity: 42 })), "");

  assert.ok(identityDigest(JSON.stringify(Array.from({ length: 5_000 }, (_, i) => ({ id: `layer-${i}` })))).length <= 2_000);
});

test("a model's window and thinking effort come from its own declaration, overridable per slot", () => {
  const deepseek = slotFor({ AE_LLM_PROVIDER: "deepseek" });
  assert.equal(deepseek.contextWindow, 1_000_000, "DeepSeek V4 declares a 1M-token window");
  assert.equal(deepseek.contextWindowSource, "service default");

  assert.equal(deepseek.reasoningEffort, undefined, "an unset effort is Default: the provider's own, nothing is sent");
  const overridden = slotFor({ AE_LLM_PROVIDER: "deepseek", AE_LLM_CONTEXT_WINDOW: "200000", AE_LLM_REASONING_EFFORT: "low" });
  assert.equal(overridden.contextWindow, 200_000);
  assert.equal(overridden.contextWindowSource, "declared in environment");
  assert.equal(overridden.reasoningEffort, "low");

  const openrouter = slotFor({ AE_LLM_PROVIDER: "openrouter", AE_LLM_MODEL: "some/model" });
  assert.equal(openrouter.contextWindow, 128_000);
  assert.equal(openrouter.contextWindowSource, "conservative assumption");

  assert.equal(slotFor({ AE_LLM_PROVIDER: "deepseek", AE_LLM_REASONING_EFFORT: "turbo" }).reasoningEffort, undefined, "an unknown level is no choice");

  assert.equal(slotFor({ AE_LLM_PROVIDER: "deepseek", AE_LLM_CONTEXT_WINDOW: "-5" }).contextWindow, 1_000_000);
});

test("an older queue write the queue accepted carries its operations once, in the queue, not again in every request", () => {
  const operations = Array.from({ length: 24 }, (_, index) => ({ type: "set_layer_name", target: { layerId: String(index) }, name: `Layer ${index} ${"n".repeat(120)}` }));
  const call = (id: string) => ({ id, name: "ae_queue_add", arguments: { summary: "Build", operations } });
  const wire = (id: string) => ({ role: "assistant", content: "", tool_calls: [{ id, type: "function", function: { name: "ae_queue_add", arguments: JSON.stringify({ summary: "Build", operations }) } }] });
  const messages: AgentMessage[] = [
    { role: "user", content: "build it" },
    { role: "assistant", content: "", toolCalls: [call("accepted")], raw: wire("accepted") },
    { role: "tool", toolCallId: "accepted", name: "ae_queue_add", content: JSON.stringify({ queued: 24, accepted: 24, next: "Accepted" }) },
    { role: "assistant", content: "", toolCalls: [call("refused")], raw: wire("refused") },
    { role: "tool", toolCallId: "refused", name: "ae_queue_add", content: JSON.stringify({ queued: 0, accepted: 0, fix: [{ position: 3, positions: [3], message: "bad" }], next: "Nothing queued" }) },
    { role: "assistant", content: "", toolCalls: [call("newest")], raw: wire("newest") },
    { role: "tool", toolCallId: "newest", name: "ae_queue_add", content: JSON.stringify({ queued: 48, accepted: 24, next: "Accepted" }) },
  ];
  foldOldToolResults(messages, 1_000);
  const firstCall = (index: number) => present(assistantAt(messages, index).toolCalls?.[0], `a tool call at ${index}`);
  const wireArguments = (index: number): string => {
    const wired = decode(WIRE_CALLS, assistantAt(messages, index).raw);
    return present(wired.ok ? wired.value.tool_calls[0]?.function.arguments : undefined, `replayed arguments at ${index}`);
  };
  assert.equal(typeof firstCall(1).arguments.operations, "string", "the accepted call's operations are folded");
  assert.equal(firstCall(1).arguments.summary, "Build", "short fields stay");
  assert.ok(!wireArguments(1).includes("set_layer_name"), "and so is the provider's replayed copy");
  assert.ok(Array.isArray(firstCall(3).arguments.operations), "a refused call keeps what the model has to resend");
  assert.ok(wireArguments(3).includes("set_layer_name"));
  assert.ok(Array.isArray(firstCall(5).arguments.operations), "the newest step is never folded");
});

const RESULT_CHARS = 9_000;
const WIRE_CALLS = object({ tool_calls: array(object({ function: object({ arguments: string() }) })) });
const inspectResult = (_name: string, args: ToolArguments) => ({ ok: true as const, data: { layer: args.layerId ?? null, note: "r".repeat(RESULT_CHARS) } });
async function measuredRun(briefing: string): Promise<{ messages: number; total: number }[]> {
  const budget = turnBudget(undefined, undefined);
  const sizes: { messages: number; total: number }[] = [];
  const provider = new MockProvider({ script: (input) => {
    sizes.push({ messages: promptTokens(input.messages, "", [], budget.charsPerToken), total: promptTokens(input.messages, input.system, input.tools, budget.charsPerToken) });
    const done = input.messages.filter((message) => message.role === "tool").length;
    return done < 24 ? { text: "", toolCalls: [{ id: `c${done}`, name: "ae_inspect_layer", arguments: { compositionId: "comp-1", layerId: `layer-${done}` } }] } : { text: "Done.", toolCalls: [] };
  } });
  const run = await runAgent(provider, { requestId: "req-measured", message: "go", history: [], briefing, liveState: () => "live", callTool: inspectResult });
  assert.equal(run.failure, undefined);
  return sizes;
}

test("a long continuation-style run holds the whole request to the working set when the briefing is large", async () => {
  const sizes = await measuredRun("b".repeat(70_000));
  const budget = turnBudget(undefined, undefined);
  const first = present(sizes[0], "the first request size");
  const prefix = first.total - first.messages;
  assert.ok(prefix > 20_000, `the prefix is the large part of this request, ${prefix}`);
  const oneResult = Math.ceil(RESULT_CHARS / budget.charsPerToken);
  for (const [index, size] of sizes.entries()) {
    assert.ok(size.messages <= MIN_MESSAGE_WORKING_TOKENS + oneResult, `step ${index + 1} carried ${size.messages} message tokens beside a ${prefix}-token prefix`);
  }
  const peak = Math.max(...sizes.map((size) => size.messages));
  assert.ok(sizes.some((size, index) => index > 0 && size.messages < peak - oneResult), "the fold brought the messages back down");
});

test("with a small prefix the messages keep the rest of the working set", async () => {
  const sizes = await measuredRun("b");
  const budget = turnBudget(undefined, undefined);
  const peak = Math.max(...sizes.map((size) => size.total));
  assert.ok(peak <= budget.workingSetTokens + Math.ceil(RESULT_CHARS / budget.charsPerToken), `the request peaked at ${peak} tokens against a ${budget.workingSetTokens}-token working set`);
  assert.ok(peak > budget.workingSetTokens * 0.7, "and used it, since a small prefix leaves the messages their room");
});

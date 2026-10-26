// How a turn dispatches the tools a reply names: calls run in the order given, a seal beside a refused write does not run, unparsed arguments are refused, and a restricted turn runs only its allowlist.
import assert from "node:assert/strict";
import test from "node:test";
import { runAgent, type AgentLogLine, type AgentToolLogLine } from "../src/agent.js";
import { array, decode, object, optional, string } from "@extynt/decode";
import { MockProvider } from "@extynt/llm";
import { present, queueAdd, queueFinish, toolMessages } from "./agent-test-support.js";

const OPERATION_NAMES = object({ operations: array(object({ name: optional(string()) })) });

test("two tool calls in one reply run in the order the reply gave, and both results are carried", async () => {
  const called: string[] = [];
  let step = 0;
  const provider = new MockProvider({ script: () => {
    step += 1;
    if (step > 1) return { text: "Queued both.", toolCalls: [] };
    return { text: "", toolCalls: [queueAdd("add-1", "First"), queueAdd("add-2", "Second")] };
  } });
  const result = await runAgent(provider, {
    requestId: "req-ordered-calls",
    message: "Queue the two renames",
    history: [],
    briefing: "briefing",
    callTool: (name, args) => {
      const decoded = decode(OPERATION_NAMES, args);
      called.push(`${name}:${decoded.ok ? decoded.value.operations[0]?.name ?? "" : ""}`);
      return { ok: true, data: { queued: called.length, summary: args.summary ?? null } };
    },
  });

  assert.deepEqual(called, ["ae_queue_add:First", "ae_queue_add:Second"], "the second call is not started before the first has answered");
  const carried = toolMessages(provider.stepInputs[1]?.messages ?? []);
  assert.equal(carried.length, 2, "both results are carried, not merged or dropped");
  assert.ok(carried[0]?.content.includes('"queued":1'), "the first result carried is the first call's own");
  assert.ok(carried[1]?.content.includes('"queued":2'), "and it is followed by the second's, in that order");
  assert.deepEqual(result.tools.map((tool) => tool.name), ["ae_queue_add", "ae_queue_add"], "the turn reports both calls");
});

test("a seal sent in the same reply as a refused queue write does not run, and says why", async () => {
  const ran: string[] = [];
  let step = 0;
  const provider = new MockProvider({ script: () => {
    step += 1;
    if (step === 1) return { text: "", toolCalls: [queueAdd("add-1"), queueFinish("finish-1")] };
    if (step === 2) return { text: "", toolCalls: [queueAdd("add-2"), queueFinish("finish-2")] };
    return { text: "Done.", toolCalls: [] };
  } });
  const result = await runAgent(provider, { requestId: "req-refused-add", message: "Rename the title", history: [], briefing: "briefing", callTool: (name) => {
    ran.push(name);
    if (name === "ae_queue_add" && ran.length === 1) return { ok: true, data: { queued: 0, accepted: 0, fix: [{ index: 0, code: "INVALID_OPERATION" }], next: "Correct it and send the whole call again." } };
    return { ok: true, data: { queued: 1, accepted: 1 } };
  } });
  assert.deepEqual(ran, ["ae_queue_add", "ae_queue_add", "ae_queue_finish"], "the first finish never reached the queue; the second, after an accepted add, did");
  assert.equal(result.tools[1]?.code, "NOT_RUN_AFTER_REFUSAL");
  assert.match(result.tools[1]?.message ?? "", /ae_queue_add call before it in this step named operations to fix/);
});

test("a seal sent beside a partly queued write does not run either, and tells the model to resend only what is owed", async () => {
  const ran: string[] = [];
  let step = 0;
  const provider = new MockProvider({ script: () => {
    step += 1;
    if (step === 1) return { text: "", toolCalls: [queueAdd("add-1"), queueFinish("finish-1")] };
    return { text: "Done.", toolCalls: [] };
  } });
  const result = await runAgent(provider, { requestId: "req-partial-add", message: "Rename the title", history: [], briefing: "briefing", callTool: (name) => {
    ran.push(name);
    return { ok: true, data: { queued: 5, accepted: 5, fix: [{ position: 2, positions: [2], code: "INVALID_OPERATION", message: "bad" }], resend: [2], next: "5 of 6 operations staged." } };
  } });
  assert.deepEqual(ran, ["ae_queue_add"], "the finish never reached the queue");
  assert.equal(result.tools[1]?.code, "NOT_RUN_AFTER_REFUSAL");
  assert.match(result.tools[1]?.message ?? "", /Resend only the positions that answer names/);
});

test("a tool call whose arguments did not parse is refused, never run with nothing", async () => {
  const ran: string[] = [];
  const provider = new MockProvider({ script: (input) => {
    const answered = toolMessages(input.messages)[0];
    if (!answered) return { text: "", toolCalls: [{ id: "undo-1", name: "ae_undo_agent_work", arguments: {}, argumentsError: "the arguments were not valid JSON (Unexpected end of JSON input)" }] };
    return { text: `Stopped: ${answered.content}`, toolCalls: [] };
  } });
  const result = await runAgent(provider, { requestId: "req-bad-args", message: "undo the last batch", history: [], briefing: "briefing", autoApply: false, callTool: (name) => { ran.push(name); return { ok: true, data: {} }; } });
  assert.deepEqual(ran, [], "an undo whose scope could not be read must not run as its default scope, which is everything");
  assert.deepEqual(result.tools, [{ name: "ae_undo_agent_work", ok: false, code: "INVALID_TOOL_ARGUMENTS", message: "Nothing ran: the arguments were not valid JSON (Unexpected end of JSON input). Send ae_undo_agent_work again with its arguments as one JSON object." }]);
  assert.match(result.answer, /INVALID_TOOL_ARGUMENTS/, "the model is told why, on its own tool result");
});

test("a refused scene build is logged and answered, never thrown as a provider failure", async () => {
  const logged: AgentLogLine[] = [];
  const provider = new MockProvider({ script: (input) => {
    if (!toolMessages(input.messages)[0]) return { text: "", toolCalls: [{ id: "design-1", name: "ae_queue_design", arguments: {} }] };
    return { text: "The scene was refused.", toolCalls: [] };
  } });
  const result = await runAgent(provider, { requestId: "req-design-refused", message: "make a title", history: [], briefing: "briefing", autoApply: false, workflowSpecialists: true, log: (entry) => { logged.push(entry); }, callTool: () => ({ ok: false, error: { code: "DESIGN_QUEUE_REJECTED", message: "The compiled scene batch was refused and no layers were queued." } }) });
  assert.equal(result.failure, undefined);
  assert.equal(result.answer, "The scene was refused.");
  const row = logged.find((entry): entry is AgentToolLogLine => entry.event === "agent.tool");
  assert.equal(row?.code, "DESIGN_QUEUE_REJECTED");
  assert.equal(row?.designResult, undefined, "a refusal carries no scene result to log");
});

test("discovery allowlist remains enforced when a provider requests hidden mutations", async () => {
  const dispatched: string[] = [];
  const provider = new MockProvider({ script: (input) => toolMessages(input.messages).length
    ? { text: "Discovery remains read-only.", toolCalls: [] }
    : { text: "", toolCalls: [
      { id: "read", name: "ae_read_graph_page", arguments: { target: { kind: "index" }, limit: 10 } },
      { id: "write", name: "ae_queue_add", arguments: {} },
      { id: "seal", name: "ae_queue_finish", arguments: {} },
      { id: "undo", name: "ae_undo", arguments: {} },
      { id: "stage", name: "ae_select_workflow_stage", arguments: {} },
    ] } });
  const result = await runAgent(provider, {
    requestId: "bootstrap-allowlist", message: "Find my target", history: [], briefing: "Read-only discovery", maxSteps: 3,
    allowedTools: ["ae_read_graph_page", "ae_get_graph_page"],
    callTool: (name) => { dispatched.push(name); return { ok: true, data: { writeAuthorizing: false, snapshotAvailable: true } }; },
  });
  assert.deepEqual(dispatched, ["ae_read_graph_page"]);
  assert.deepEqual(present(provider.stepInputs[0]).tools.map((tool) => tool.name).sort(), ["ae_get_graph_page", "ae_read_graph_page"]);
  assert.deepEqual(result.plans, []);
  assert.equal(result.tools.filter((tool) => tool.ok).length, 1);
});

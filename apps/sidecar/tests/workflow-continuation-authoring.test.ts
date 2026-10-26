/** The turn's authoring accounting: how long it took, the clock it counts down, and the line it polls. */
import { present } from "./agent-test-support.js";
import { fieldOf, flagOf, maybeNumberOf, maybeRecordOf, numberOf, readJson, textOf } from "./http-json.js";
import { AUTHORING_MS_CEILING, boundedAuthoringMs } from "../src/server-durations.js";
import { authorization, chatTurn, mutableSnapshot, pause, sidecarFor, token, workflowStageStep } from "./sidecar-fixture.js";
import { MockProvider } from "@extynt/llm";
import assert from "node:assert/strict";
import test from "node:test";

function assertWorkflowStageBoundaryResult(result: Awaited<ReturnType<typeof chatTurn>>): void {
  assert.equal(result.outcome, "planned", JSON.stringify(result));
  assert.deepEqual(result.plans[0]?.operations.length, 1, "the rejected 26-operation call cannot stage a prefix");
  assert.ok(result.tools.some((tool) => tool.name === "ae_queue_add" && tool.code === "WORKFLOW_BATCH_BOUND"), "the over-bound call is visibly refused by the sidecar");
}

function assertWorkflowStagePolicy(provider: MockProvider): void {
  assert.equal(provider.stepInputs[0]?.reasoningEffort, "medium", "stage selection runs at medium, never the configured full reasoning budget");
  assert.equal(provider.stepInputs[1]?.reasoningEffort, "high", "authoring restores the configured provider effort after stage selection");
  assert.match(provider.stepInputs[0]?.system ?? "", /One loop\./);
  assert.match(provider.stepInputs[0]?.system ?? "", /ae_ask_user/);
}

function assertWorkflowStageReference(provider: MockProvider): void {
  const stageResult = provider.stepInputs[1]?.messages.find((message) => message.role === "tool" && message.name === "ae_select_workflow_stage");
  assert.match(stageResult?.content ?? "", /operationReferences|set_layer_name/, "the selection result supplies a compact field reference instead of making the model rediscover it");
  assert.doesNotMatch(stageResult?.content ?? "", /inputSchema|planShape/, "a broad stage cannot dump full per-variant schemas into one foldable tool result");
}

test("workflow-v1 selects one stage at medium effort, then enforces one undo batch before authoring", async (t) => {
  const operation = (name: string) => ({ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name });
  const provider = new MockProvider({ script: (input) => {
    const called = input.messages.filter((message) => message.role === "tool").map((message) => message.name);
    const adds = called.filter((name) => name === "ae_queue_add").length;
    if (!called.includes("ae_select_workflow_stage")) return { text: "", toolCalls: [{ id: "stage", name: "ae_select_workflow_stage", arguments: { summary: "Rename the selected layer", operationTypes: ["set_layer_name"] } }] };
    if (adds === 0) return { text: "", toolCalls: [{ id: "too-large", name: "ae_queue_add", arguments: { summary: "Too much", operations: Array.from({ length: 26 }, (_, index) => operation(`Draft ${index}`)) } }] };
    if (adds === 1) return { text: "", toolCalls: [{ id: "bounded", name: "ae_queue_add", arguments: { summary: "One bounded rename", operations: [operation("Hero")] } }] };
    if (!called.includes("ae_queue_finish")) return { text: "", toolCalls: [{ id: "finish", name: "ae_queue_finish", arguments: {} }] };
    return { text: "Done.", toolCalls: [] };
  } });
  Object.assign(provider.config, { reasoningEffort: "high" as const });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("workflow-stage-boundary")) });
  const result = await chatTurn(address, "rename this to Hero, as the first part of a larger cleanup");

  assertWorkflowStageBoundaryResult(result);
  assertWorkflowStagePolicy(provider);
  assertWorkflowStageReference(provider);
  const status = await readJson((await fetch(`http://${address.host}:${address.port}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ name: "ae_status", arguments: {} }) })));
  assert.equal(textOf(status, "data.workflowEngine"), "workflow-v1", "the active engine is visible in the same status surface the model reads");
});

test("workflow-v1 leaves read-only question turns usable and releases their empty workflow job", async (t) => {
  const provider = new MockProvider({ script: (input) => {
    const called = input.messages.filter((message) => message.role === "tool").map((message) => message.name);
    if (!called.includes("ae_inspect_layer")) return { text: "", toolCalls: [{ id: "inspect", name: "ae_inspect_layer", arguments: { compositionId: "comp-1", layerId: "layer-1" } }] };
    return { text: "The selected layer has one Gaussian Blur effect.", toolCalls: [] };
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("workflow-question")) });

  const first = await chatTurn(address, "what effects are on this layer?");
  assert.equal(first.outcome, "answered", JSON.stringify(first));
  assert.equal(provider.stepInputs[0]?.reasoningEffort, undefined, "an unset provider effort stays unset instead of enabling unsupported thinking fields");
  assert.equal(first.tools.find((tool) => tool.name === "ae_inspect_layer")?.ok, true, "inspection is not stage-gated");
  assert.match(first.answer, /Gaussian Blur/);

  const second = await chatTurn(address, "and check it once more");
  assert.equal(second.outcome, "answered", "the cancelled empty job must release the workflow lane for the next turn");
});

test("workflow-v1 can discover an unknown operation type before selecting a corrected stage", async (t) => {
  const provider = new MockProvider({ script: (input) => {
    const called = input.messages.filter((message) => message.role === "tool").map((message) => message.name);
    const stages = called.filter((name) => name === "ae_select_workflow_stage").length;
    if (stages === 0) return { text: "", toolCalls: [{ id: "bad-stage", name: "ae_select_workflow_stage", arguments: { summary: "Rename the selected layer", operationTypes: ["rename_layer"] } }] };
    if (!called.includes("ae_search_native_operations")) return { text: "", toolCalls: [{ id: "search", name: "ae_search_native_operations", arguments: { query: "layer name", limit: 5 } }] };
    if (stages === 1) return { text: "", toolCalls: [{ id: "good-stage", name: "ae_select_workflow_stage", arguments: { summary: "Rename the selected layer", operationTypes: ["set_layer_name"] } }] };
    if (!called.includes("ae_queue_add")) return { text: "", toolCalls: [{ id: "add", name: "ae_queue_add", arguments: { summary: "Rename layer", operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name: "Hero" }] } }] };
    return { text: "", toolCalls: [{ id: "finish", name: "ae_queue_finish", arguments: {} }] };
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("workflow-discovery")) });

  const result = await chatTurn(address, "rename this layer to Hero");
  assert.equal(result.outcome, "planned", JSON.stringify(result));
  assert.ok(result.tools.some((tool) => tool.name === "ae_select_workflow_stage" && tool.code === "UNKNOWN_WORKFLOW_OPERATION"));
  assert.equal(result.tools.find((tool) => tool.name === "ae_search_native_operations")?.ok, true, "operation discovery remains reachable before a valid stage exists");
});

test("workflow-v1 mechanically closes a partially authored stage over known operation types", async (t) => {
  const property = { type: "set_layer_property", target: { compositionId: "comp-1", layerId: "layer-1" }, role: "transform.position", propertyPath: "ADBE Transform Group/ADBE Position", value: [100, 100] };
  const provider = new MockProvider({ script: (input) => {
    const called = input.messages.filter((message) => message.role === "tool").map((message) => message.name);
    const stages = called.filter((name) => name === "ae_select_workflow_stage").length;
    const adds = called.filter((name) => name === "ae_queue_add").length;
    if (stages === 0) return { text: "", toolCalls: [{ id: "stage-name", name: "ae_select_workflow_stage", arguments: { summary: "Prepare the selected layer", operationTypes: ["set_layer_name"] } }] };
    if (adds === 0) return { text: "", toolCalls: [{ id: "add-name", name: "ae_queue_add", arguments: { operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name: "Hero" }] } }] };
    if (adds === 1) return { text: "", toolCalls: [{ id: "outside-scope", name: "ae_queue_add", arguments: { operations: [property] } }] };
    return { text: "", toolCalls: [{ id: "finish", name: "ae_queue_finish", arguments: {} }] };
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("workflow-stage-expand")) });

  const result = await chatTurn(address, "rename and reposition this layer");
  assert.equal(result.outcome, "planned", JSON.stringify(result));
  assert.equal(result.plans[0]?.operations.length, 2);
  assert.equal(result.tools.some((tool) => tool.name === "ae_queue_add" && tool.code === "WORKFLOW_STAGE_SCOPE"), false);
  assert.equal(result.tools.filter((tool) => tool.name === "ae_select_workflow_stage" && tool.ok).length, 1, "known operation types close into the bounded stage without another model retry");
});

test("authoringMs measures the turn's own authoring, and is absent rather than zero when it cannot be measured", async (t) => {

  const provider = new MockProvider({ script: async () => { await new Promise((resolve) => setTimeout(resolve, 60)); return { text: "Done.", toolCalls: [] }; } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  await fetch(`${base}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-authoring")) });
  const startedAt = Date.now();
  const response = await readJson((await fetch(`${base}/v1/chat`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ requestId: "chat-authoring", message: "hello" }) })));
  const wallMs = Date.now() - startedAt;
  assert.equal(textOf(response, "answer"), "Done.");
  assert.equal(typeof maybeNumberOf(response, "authoringMs"), "number", "the reply carries how long the authoring half of the turn took");
  assert.ok((maybeNumberOf(response, "authoringMs") ?? 0) >= 50, `a 60 ms model call cannot be measured as ${maybeNumberOf(response, "authoringMs")} ms: the bracket has to span the run, not precede it`);
  assert.ok((maybeNumberOf(response, "authoringMs") ?? 0) <= wallMs, `authoringMs (${maybeNumberOf(response, "authoringMs")}) cannot exceed the request it was measured inside (${wallMs})`);
  assert.equal(Number.isInteger(maybeNumberOf(response, "authoringMs")), true, "a millisecond count is a whole number, like every other timing on a receipt");

  assert.equal(boundedAuthoringMs(Number.NaN), undefined);
  assert.equal(boundedAuthoringMs(Number.NEGATIVE_INFINITY), undefined);
  assert.equal(boundedAuthoringMs(Number.POSITIVE_INFINITY), undefined);
  assert.equal(boundedAuthoringMs(-1), undefined);
  assert.equal(boundedAuthoringMs(AUTHORING_MS_CEILING + 1), AUTHORING_MS_CEILING);
  assert.equal(boundedAuthoringMs(1234.9), 1234);
  assert.equal(boundedAuthoringMs(0), 0, "a measured zero is a measurement, and only a measurement may be reported as one");
});

test("the turn-state line names no deadline and tells the model not to stop early", async (t) => {
  const provider = new MockProvider({ answer: "Read it." });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-turn-clock")) });
  await chatTurn(address, "hello");
  const line = String(provider.stepInputs[0]?.messages.at(-1)?.content ?? "").split("\n").find((entry) => entry.startsWith("turn: ")) ?? "";
  assert.match(line, /^turn: there is no time limit on this job/, `the turn-state line names no deadline, got ${JSON.stringify(line)}`);
  assert.doesNotMatch(line, /\d+m\b|minute|stops waiting/, "no clock or per-step cost reaches the model");
});

test("the authoring line is pollable while the turn runs and reports the plan's own counts", async (t) => {

  const observed: Array<{ label: string; operations: number; batches: number; sealed: boolean; planId: string; jobId: string | null }> = [];
  const provider = new MockProvider({ script: async (input) => {
    const called = input.messages.filter((message) => message.role === "tool").map((message) => message.name);
    if (!called.includes("ae_select_workflow_stage")) return workflowStageStep("leader", "Count the leader in", ["set_layer_name", "set_layer_property"]);
    if (!called.includes("ae_queue_add")) return { text: "", toolCalls: [{ id: "c1", name: "ae_queue_add", arguments: { summary: "Countdown leader", operations: [
      { type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name: "Three" },
      { type: "set_layer_property", target: { compositionId: "comp-1", layerId: "layer-1" }, role: "transform.position", propertyPath: "ADBE Transform Group/ADBE Position", value: [100, 100] },
    ] } }] };
    if (!called.includes("ae_queue_finish")) {

      const progress = await readJson((await fetch(`http://${address.host}:${address.port}/v1/chat/progress`, { headers: authorization })));
      const authoring = maybeRecordOf(progress, "progress.authoring");
      if (authoring) observed.push({ label: textOf(authoring, "label"), operations: numberOf(authoring, "operations"), batches: numberOf(authoring, "batches"), sealed: flagOf(authoring, "sealed"), planId: textOf(authoring, "planId"), jobId: typeof fieldOf(authoring, "jobId") === "string" ? textOf(authoring, "jobId") : null });
      return { text: "", toolCalls: [{ id: "c2", name: "ae_queue_finish", arguments: {} }] };
    }
    return { text: "Queued two operations.", toolCalls: [] };
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true, maxAgentSteps: 12 });
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-authoring-line")) });
  const reply = await chatTurn(address, "count the leader in");
  assert.equal(reply.outcome, "planned");
  assert.equal(observed.length, 1, "the line must be readable while the turn is still running, not only in its reply");
  const line = present(observed[0]);
  assert.equal(line.operations, 2, "the count is the plan's accepted operations, not a step number");
  assert.equal(line.batches, 1, "and the calls those operations arrived in");
  assert.equal(line.sealed, false, "the plan is still being authored");
  assert.equal(line.label, "Authoring 2 operations in 1 call");
  assert.match(line.planId, /^plan-/, "and it names the plan the counts belong to");
  assert.match(String(line.jobId), /^job-/, "and the job that plan is a batch of");

  const after = await readJson((await fetch(`http://${address.host}:${address.port}/v1/chat/progress`, { headers: authorization })));
  const lingering = maybeRecordOf(after, "progress.authoring");
  assert.ok(!lingering || flagOf(lingering, "sealed"), `the line left for the pending receipt reads as sealed, got ${JSON.stringify(lingering)}`);
});

type AuthoringLine = { label: string; operations: number; batches: number; sealed: boolean };

const authoringLineMatching = async (address: { host: string; port: number }, matches: (line: AuthoringLine) => boolean, timeoutMs = 5_000): Promise<AuthoringLine | undefined> => {
  const deadline = Date.now() + timeoutMs;
  let seen: AuthoringLine | undefined;
  while (Date.now() < deadline) {
    const progress = await readJson((await fetch(`http://${address.host}:${address.port}/v1/chat/progress`, { headers: authorization })));
    const authoring = maybeRecordOf(progress, "progress.authoring");
    seen = authoring === undefined ? undefined : { label: textOf(authoring, "label"), operations: numberOf(authoring, "operations"), batches: numberOf(authoring, "batches"), sealed: flagOf(authoring, "sealed") };
    if (seen && matches(seen)) return seen;
    await pause(10);
  }
  return seen;
};

test("a refused queue call records progress for the operations it staged, and only those", async (t) => {

  const rename = (name: string) => ({ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name });

  const refusedEarly = { type: "ensure_shape_fill", target: { compositionId: "comp-1", layerId: "layer-1" }, groupId: "nope", color: [1, 0, 0] };
  const nothingStaged = [...Array.from({ length: 5 }, (_, index) => rename(`Draft ${index}`)), refusedEarly, ...Array.from({ length: 19 }, (_, index) => rename(`Draft ${index + 5}`))];

  const prefixStaged = [...Array.from({ length: 24 }, (_, index) => rename(`Take ${index}`)), refusedEarly];
  let turn = 0;
  const gates = [false, false];
  const provider = new MockProvider({ script: async (input) => {
    const called = input.messages.filter((message) => message.role === "tool").map((message) => message.name);
    if (!called.includes("ae_select_workflow_stage")) { turn += 1; return workflowStageStep(`takes-${turn}`, "Write the takes"); }
    if (!called.includes("ae_queue_add")) return { text: "", toolCalls: [{ id: `add-${turn}`, name: "ae_queue_add", arguments: { summary: `Attempt ${turn}`, operations: turn === 1 ? nothingStaged : prefixStaged } }] };

    while (!gates[turn - 1]) await pause(5);
    return { text: "The refusal says what to fix.", toolCalls: [] };
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true, maxAgentSteps: 6 });
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-authoring-refusal")) });

  try {
    const first = chatTurn(address, "write the takes");
    const nothing = await authoringLineMatching(address, (line) => line.operations === 24 && line.batches === 1);
    assert.equal(nothing?.label, "Authoring 24 operations in 1 call", `the 24 independent operations are progress, the refused one is not, got ${JSON.stringify(nothing)}`);
    gates[0] = true;
    assert.equal((await first).ok, true);

    const second = chatTurn(address, "write the takes again");
    const staged = await authoringLineMatching(address, (line) => line.operations === 24 && line.batches === 1);
    assert.equal(staged?.operations, 24, `the refused operation landed nothing but the 24 before it did, got ${JSON.stringify(staged)}`);
    assert.equal(staged?.label, "Authoring 24 operations in 1 call");
    gates[1] = true;
    assert.equal((await second).ok, true);
  } finally { gates[0] = true; gates[1] = true; }
});

/** The chat surface: read-only answers, screenshots, queued plan cards, fallback between models, JSONL transcripts. */
import type { JsonValue } from "@extynt/decode";
import { fieldOf, flagOf, listOf, maybeTextOf, numberOf, parseJson, readJson, recordOf, recordsOf, textOf } from "./http-json.js";
import { authorization, chatTurn, mutableSnapshot, queueFinishStep, queueScript, sidecarFor, token, validSnapshot, workflowStageStep } from "./sidecar-fixture.js";
import { MockProvider, splitTransient, type AgentStepInput } from "@extynt/llm";
import { IN_PANEL_AGENT_HIDDEN_TOOLS } from "@extynt/mcp-server";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { present } from "./present.js";

test("a review request is the agent's to honour: the sidecar keeps the toggle and briefs the explicit hold", async (t) => {
  const provider = new MockProvider({ answer: "Here is the plan for review." });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("review-boundary")) });
  const response = await fetch(`http://${address.host}:${address.port}/v1/chat`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ requestId: "review-boundary", message: "Add a glow, but don't apply it to the background layer.", autoApply: true }) });
  assert.equal(response.status, 200);
  const system = provider.stepInputs[0]?.system ?? "";
  assert.match(system, /autoApply: ON/);
  assert.match(system, /ae_queue_finish review: true/, "the agent is told how to hold a batch for the user's Apply");
});

test("read-only chat uses the latest snapshot and requires an explicit provider", async (t) => {
  const sidecar = sidecarFor({ port: 0, token, chatProvider: new MockProvider({ answer: "The selected layer is layer-1." }), quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const beforeSnapshot = await fetch(`http://${address.host}:${address.port}/v1/chat`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ requestId: "chat-before", message: "What is selected?" }) });
  assert.equal(beforeSnapshot.status, 200);
  assert.deepEqual(listOf(await readJson(beforeSnapshot), "plans"), []);
  const accepted = await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(validSnapshot) });
  assert.equal(accepted.status, 201);
  const chat = await fetch(`http://${address.host}:${address.port}/v1/chat`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ requestId: "chat-after", message: "What is selected?" }) });
  assert.equal(chat.status, 200);
  const response = await readJson(chat);
  assert.equal(flagOf(response, "ok"), true);
  assert.equal(textOf(response, "mode"), "agent");
  assert.equal(textOf(response, "answer"), "The selected layer is layer-1.");
  assert.deepEqual(listOf(response, "plans"), []);
});

test("providers without tool calling keep the read-only copilot path", async (t) => {
  const inner = new MockProvider({ answer: "Read-only answer." });
  const plain = { id: inner.id, model: inner.model, config: inner.config, displayMetadata: inner.displayMetadata, complete: inner.complete.bind(inner) };
  const sidecar = sidecarFor({ port: 0, token, chatProvider: plain });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const missing = await fetch(`http://${address.host}:${address.port}/v1/chat`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ requestId: "plain-missing", message: "Find my comp" }) });
  assert.equal(missing.status, 409);
  assert.equal(inner.stepInputs.length, 0);
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(validSnapshot) });
  const chat = await fetch(`http://${address.host}:${address.port}/v1/chat`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ requestId: "chat-ro", message: "What is selected?" }) });
  const response = await readJson(chat);
  assert.equal(textOf(response, "mode"), "read-only");
  assert.equal(textOf(response, "answer"), "Read-only answer.");
  assert.deepEqual(listOf(response, "context.selection.layerIds"), ["layer-1"]);
});

test("a screenshot attached to a chat message reaches the model, and anything else is refused before it is called", async (t) => {
  const provider = new MockProvider({ answer: "The ring sits off-centre." });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-image")) });
  const post = (image: JsonValue) => fetch(`http://${address.host}:${address.port}/v1/chat`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ requestId: `chat-image-${Math.random().toString(16).slice(2)}`, message: "what is wrong with this frame?", image }) });

  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
  const accepted = await post({ mediaType: "image/png", base64: png });
  assert.equal(accepted.status, 200);
  assert.deepEqual(present(provider.stepInputs[0]).image, { mediaType: "image/png", base64: png }, "the frame rides the step the model is asked about");

  const jpeg = await post({ mediaType: "image/jpeg", base64: png });
  assert.equal(jpeg.status, 200, "the attach path re-encodes to JPEG, so JPEG is a frame the panel could have sent");
  for (const bad of [{ mediaType: "image/gif", base64: png }, { mediaType: "image/png", base64: "not base64!" }, { mediaType: "image/png", base64: "AAAA" }]) {
    const refused = await post(bad);
    assert.equal(refused.status, 422, JSON.stringify(bad).slice(0, 60));
    assert.equal(maybeTextOf(await readJson(refused), "error.code"), "INVALID_CHAT_IMAGE");
  }
  assert.equal(provider.stepInputs.length, 2, "a refused frame never reaches the model");
});

test("chat agent is briefed with the project and proposes plans the panel can approve", async (t) => {
  const provider = new MockProvider({ script: queueScript("q1", "Hero") });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-agent")) });
  const response = await chatTurn(address, "rename this to Hero", [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }]);
  assert.equal(response.outcome, "planned");
  assert.equal(response.plans.length, 1);
  assert.equal(present(response.plans[0]).title, "Rename to Hero");

  assert.deepEqual(response.tools, [{ name: "ae_queue_add", ok: true }, { name: "ae_queue_finish", ok: true }]);

  const briefing = present(provider.stepInputs[0]).system;
  assert.match(briefing, /You are the After Effects agent/);

  assert.match(briefing, /ae_queue_add \{operations/);
  assert.match(briefing, /ae_queue_finish/);
  assert.doesNotMatch(briefing, /ae_propose_plan/);
  assert.match(briefing, /"selectedLayerIds":\["layer-1"\]/);

  assert.match(briefing, /^1 layer-1 "Original" text \[selected\]$/m);
  assert.doesNotMatch(briefing, /position=\[960,540\]/);
  assert.doesNotMatch(briefing, /effects=ADBE Gaussian Blur 2/);
  assert.match(briefing, /^Project index: /m);
  assert.deepEqual(splitTransient(present(provider.stepInputs[0]).messages).persisted.map((message) => message.role), ["user", "assistant", "user"]);

  const offeredToAgent = present(provider.stepInputs[0]).tools.map((tool) => tool.name);
  for (const tool of ["ae_queue_add", "ae_queue_fix", "ae_queue_finish", "ae_undo_agent_work"]) assert.ok(offeredToAgent.includes(tool), `${tool} is part of the in-panel agent's surface`);
  for (const hidden of IN_PANEL_AGENT_HIDDEN_TOOLS) assert.ok(!offeredToAgent.includes(hidden), `${hidden} is not on this model's surface`);

  const listed = recordsOf(await readJson(await fetch(`http://${address.host}:${address.port}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ name: "ae_list_plans", arguments: {} }) })), "data");
  assert.deepEqual(listed.map((row) => [textOf(row, "planId"), textOf(row, "status")]), [[present(response.plans[0]).planId, "prepared"]]);
});

function repairStep(input: AgentStepInput, repair: { index: number }) {
  const last = [...input.messages].reverse().find((message) => message.role === "tool");
  const refusal = String(last?.content ?? "");
  const index = /at #(\d+)/.exec(refusal)?.[1] ?? "";
  assert.ok(index, `the refusal must name the index to fix: ${refusal.slice(0, 200)}`);
  repair.index = Number(index);
  return { text: "", toolCalls: [{ id: "call-fix", name: "ae_queue_fix", arguments: { edits: [{ op: "remove", index: repair.index }] } }] };
}

test("a plan the model repairs by index is still the turn's plan", async (t) => {

  const parentSnapshot = mutableSnapshot("probe-amend");

  const composition = present(parentSnapshot.result.compositions[0]);
  composition.layers.push({ ...present(composition.layers[0]), id: "layer-2", index: 2, name: "Parent", selected: false });

  const placeAndParent = { id: "call-bad", name: "ae_queue_add", arguments: { summary: "Fade the layer", operations: [
    { type: "set_layer_property", target: { compositionId: "comp-1", layerId: "layer-1" }, role: "transform.opacity", propertyPath: "ADBE Transform Group/ADBE Opacity", value: 50 },
    { type: "animate_property", target: { compositionId: "comp-1", layerId: "layer-1", propertyPath: "ADBE Transform Group/ADBE Opacity" }, role: "transform.opacity", keyframes: [{ time: 0, value: 0 }, { time: 1, value: 100 }] },
  ] } };
  const repair = { amendments: 0, index: -1 };
  const provider = new MockProvider({ script: (input) => {
    const called = input.messages.filter((message) => message.role === "tool").map((message) => message.name);
    const finishes = called.filter((name) => name === "ae_queue_finish").length;
    if (!called.includes("ae_select_workflow_stage")) return workflowStageStep("repair", "Fade the layer", ["set_layer_property", "animate_property"]);
    if (!called.includes("ae_queue_add")) return { text: "", toolCalls: [placeAndParent] };
    if (finishes === 0) return queueFinishStep("first");
    if (repair.amendments++ === 0) return repairStep(input, repair);
    if (finishes === 1) return queueFinishStep("second");
    return { text: "The static opacity write could never verify under the keyframes, so I dropped it and kept the fade.", toolCalls: [] };
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(parentSnapshot) });
  const response = await chatTurn(address, "fade this layer in");
  assert.deepEqual(response.tools.map((tool) => [tool.name, tool.ok]), [["ae_select_workflow_stage", true], ["ae_queue_add", true], ["ae_queue_finish", false], ["ae_queue_fix", true], ["ae_queue_finish", true]]);
  assert.equal(response.outcome, "planned", response.answer);
  assert.equal(response.plans.length, 1, "one plan, one card");
  assert.equal(repair.index, 0, "the refusal named the static write, which is the one the model removed");

  assert.equal(present(response.plans[0]).operations.length, 1, JSON.stringify(present(response.plans[0]).operations));
  assert.ok(!present(response.plans[0]).operations.some((line) => /50/.test(line)), JSON.stringify(present(response.plans[0]).operations));

  const listed = recordsOf(await readJson(await fetch(`http://${address.host}:${address.port}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ name: "ae_list_plans", arguments: {} }) })), "data");
  assert.deepEqual(listed.map((row) => [textOf(row, "planId"), textOf(row, "status")]), [[present(response.plans[0]).planId, "prepared"]]);
});

test("a chat plan card carries the expression source the panel shows before Apply", async (t) => {
  const source = "var h = thisLayer.sourceRectAtTime(time, false).height;\nlinear(time, 0, 2, [960, 1180], [960, -100]);";
  const long = "x".repeat(4096);

  const expression = (propertyPath: string, expressionSource: string) => ({ type: "set_expression", target: { compositionId: "comp-1", layerId: "layer-1", propertyPath }, source: expressionSource, enabled: true });
  const blur = "ADBE Effect Parade/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001";
  const rollStep = { text: "", toolCalls: [{ id: "roll-add", name: "ae_queue_add", arguments: { summary: "Roll the credits", operations: [expression("ADBE Transform Group/ADBE Position", source), expression(blur, long)] } }] };
  const provider = new MockProvider({ script: (input) => {
    const called = input.messages.filter((message) => message.role === "tool").map((message) => message.name);
    if (!called.includes("ae_select_workflow_stage")) return workflowStageStep("roll", "Roll the credits", ["set_expression"]);
    if (!called.includes("ae_queue_add")) return rollStep;
    if (!called.includes("ae_queue_finish")) return queueFinishStep("roll");
    return { text: "Rolling.", toolCalls: [] };
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-expressions")) });
  const response = await chatTurn(address, "roll the credits");
  assert.equal(response.plans.length, 1);

  assert.deepEqual(present(response.plans[0]).expressions?.[0], { propertyPath: "ADBE Transform Group/ADBE Position", source });
  const bounded = present(response.plans[0]).expressions?.[1];
  assert.equal(bounded?.propertyPath, blur);
  assert.equal(bounded?.source.length, 400, "a 4096-character script cannot ride into the chat payload whole");
  assert.ok(bounded?.source.endsWith("…"), "the excerpt is marked");

  assert.ok(present(response.plans[0]).operations.some((line) => line.includes("expression: ")), `the card line carries the source: ${JSON.stringify(present(response.plans[0]).operations)}`);
});

test("a failed first model hands the turn to the second, and the queue is what the agent writes with", async (t) => {
  let primaryCalls = 0;

  const emptyAdd = { id: "a", name: "ae_queue_add", arguments: { operations: [] } };
  const primary = new MockProvider({ model: "cheap", script: (input) => {
    primaryCalls += 1;
    const called = input.messages.filter((message) => message.role === "tool").map((message) => message.name);
    if (!called.includes("ae_select_workflow_stage")) return workflowStageStep("cheap");
    const refused = called.filter((name) => name === "ae_queue_add").length;
    if (refused > 0) assert.match(String(splitTransient(input.messages).persisted.at(-1)?.content), /INVALID_ARGUMENT|at least one operation/);
    return refused < 2 ? { text: "", toolCalls: [emptyAdd] } : { text: "Sorry.", toolCalls: [] };
  } });
  const fallback = new MockProvider({ model: "strong", script: queueScript("q1", "Hero") });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: primary, fallbackChatProvider: fallback, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-fallback")) });
  const response = await chatTurn(address, "rename this to Hero");
  assert.equal(primaryCalls, 4, "the first model spent its steps on a stage, a refusal, a retry and an answer with nothing to hand the panel");
  assert.equal(response.model, "strong");
  assert.equal(response.outcome, "planned");
  assert.equal(response.fallback?.from, "Mock provider");
  assert.match(response.fallback?.reason ?? "", /^[A-Z_]+: The last plan was rejected/);

  const answered = sidecarFor({ port: 0, token, chatProvider: new MockProvider({ answer: "Just an answer." }), fallbackChatProvider: fallback, quietAgentLog: true });
  const answeredAddress = await answered.start();
  t.after(() => answered.stop());
  await fetch(`http://${answeredAddress.host}:${answeredAddress.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-answer")) });
  const plain = await chatTurn(answeredAddress, "what is selected?");
  assert.equal(plain.outcome, "answered");
  assert.equal(plain.fallback, undefined);
});

test("a chat is written as a JSONL file and the path is handed back", async (t) => {

  const { existsSync, readFileSync, statSync } = await import("node:fs");
  const root = mkdtempSync(join(tmpdir(), "extynt-chats-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sidecar = sidecarFor({ port: 0, token, stateDirectory: root, quietAgentLog: true, now: () => new Date("2026-09-17T12:00:00.000Z") });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const call = async (body: JsonValue) => { const res = await fetch(`http://${address.host}:${address.port}/v1/chats`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: res.status, text: await res.text() }; };
  const jsonl = [JSON.stringify({ type: "session", id: "s1", messages: 2 }), JSON.stringify({ type: "message", kind: "user", text: "build the leader" }), JSON.stringify({ type: "message", kind: "assistant", text: "Done." })].join("\n");

  const saved = recordOf(parseJson((await call({ sessionId: "session-abc", name: "countdown leader", jsonl })).text), "");
  assert.equal(flagOf(saved, "ok"), true);
  assert.equal(numberOf(saved, "messages"), 2, "the session line is not counted as a message");
  assert.ok(textOf(saved, "path").startsWith(join(root, "chat-logs")), "written under the profile's chat-logs directory: " + textOf(saved, "path"));
  assert.ok(textOf(saved, "path").endsWith(".jsonl"));
  assert.match(textOf(saved, "path"), /countdown-leader/, "named after the chat, so a folder of them is readable");
  assert.equal(numberOf(saved, "bytes"), jsonl.length + 1);
  assert.equal(readFileSync(textOf(saved, "path"), "utf8"), jsonl + "\n", "byte for byte, with a trailing newline");
  assert.equal(statSync(textOf(saved, "path")).mode & 0o777, 0o600, "owner-only: a transcript can name a client's project");
  assert.ok(textOf(saved, "displayPath").length > 0 && existsSync(textOf(saved, "path")));

  for (const bad of [{ sessionId: "x", jsonl: "not json\n" }, { sessionId: "", jsonl }, { sessionId: "x", jsonl: "[1,2]\n" }, { sessionId: "x", jsonl: "" }, { jsonl }]) {
    const refused = await call(bad);
    assert.equal(refused.status, 422, JSON.stringify(bad).slice(0, 60));
    assert.equal(maybeTextOf(parseJson(refused.text), "error.code"), "INVALID_CHAT_EXPORT");
  }
});

test("automatic chat logs append revisions idempotently and export to a chosen JSONL path", async (t) => {
  const { readFileSync, statSync } = await import("node:fs");
  const root = mkdtempSync(join(tmpdir(), "extynt-chat-log-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sidecar = sidecarFor({ port: 0, token, stateDirectory: root, quietAgentLog: true, now: () => new Date("2026-09-22T12:00:00.000Z") });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const post = async (path: string, body: JsonValue) => fetch(`http://${address.host}:${address.port}${path}`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(body) });
  const batch = { schemaVersion: "extynt.chat-log/0.1", sessionId: "session-abc", name: "Vector badge", events: [
    { type: "session", eventId: "session", revision: 1, data: { id: "session-abc", name: "Vector badge" } },
    { type: "message", eventId: "message-1", revision: 1, data: { kind: "user", text: "Build the badge" } },
    { type: "message", eventId: "message-2", revision: 1, data: { kind: "assistant", text: "Done", reasoning: [{ text: "Used inline SVG" }] } }
  ] };
  assert.equal((await post("/v1/chat-logs", batch)).status, 200);
  assert.equal((await post("/v1/chat-logs", batch)).status, 200, "a retried batch is accepted without duplicating revisions");
  const revised = { ...batch, events: [{ type: "message", eventId: "message-2", revision: 2, data: { kind: "assistant", text: "Done", status: "verified" } }] };
  assert.equal((await post("/v1/chat-logs", revised)).status, 200);
  const archive = join(root, "chat-logs", "session-abc.jsonl");
  const lines = readFileSync(archive, "utf8").trim().split("\n").map((line) => recordOf(parseJson(line), ""));
  assert.equal(lines.length, 4, "three original events and one later revision are append-only");
  assert.deepEqual(lines.map((line) => line.revision), [1, 1, 1, 2]);
  assert.equal(statSync(archive).mode & 0o777, 0o600);

  const destination = join(root, "chosen-full-transcript.jsonl");
  const exported = await post("/v1/chat-logs/export", { destination });
  assert.equal(exported.status, 200);
  const contents = readFileSync(destination, "utf8");
  assert.match(contents, /extynt\.chat-log-export\/0\.1/);
  assert.match(contents, /Build the badge/);
  assert.match(contents, /"revision":2/);
});

test("what the model says on its way to an answer becomes its own chat message, and the turn's progress is pollable while it runs", async (t) => {

  const provider = new MockProvider({ script: (input) => {
    const tools = input.messages.filter((message) => message.role === "tool").length;
    if (tools === 0) return { text: "Let me look at what is selected first.", toolCalls: [{ id: "c1", name: "ae_get_current_context", arguments: {} }] };
    if (tools === 1) return { text: "That layer already has a blur, so I will reuse it.", toolCalls: [{ id: "c2", name: "ae_queue_add", arguments: { summary: "Rename to Hero", operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name: "Hero" }] } }] };
    return { text: "Renamed.", toolCalls: [] };
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-notes")) });
  const response = await chatTurn(address, "rename this");
  assert.deepEqual(response.notes, ["Let me look at what is selected first.", "That layer already has a blur, so I will reuse it."]);
  assert.equal(response.answer, "Renamed.");

  const progress = await readJson((await fetch(`http://${address.host}:${address.port}/v1/chat/progress`, { headers: authorization })));
  assert.equal(flagOf(progress, "ok"), true);
  assert.equal(fieldOf(progress, "progress"), null);
});

test("snapshot arriving during discovery cannot enable writes; the next turn uses workflow", async (t) => {
  let base = "";
  let first = true;
  const provider = new MockProvider({ script: async input => {
    if (first) {
      first = false;
      const accepted = await fetch(`${base}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("bootstrap-arrival")) });
      assert.equal(accepted.status, 201);
      return { text: "", toolCalls: [{ id: "forbidden-write", name: "ae_queue_add", arguments: { summary: "Forbidden bootstrap rename", operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name: "Unexpected" }] } }] };
    }
    return { text: "Target metadata is available; this discovery turn made no changes.", toolCalls: [] };
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  base = `http://${address.host}:${address.port}`;
  t.after(() => sidecar.stop());
  const send = (requestId: string) => fetch(`${base}/v1/chat`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ requestId, message: "Find my target", autoApply: true }) });
  const bootstrap = await readJson(await send("bootstrap-frozen"));
  assert.deepEqual(listOf(bootstrap, "plans"), []);
  assert.equal(recordsOf(bootstrap, "tools")[0]?.ok, false);
  assert.equal(present(provider.stepInputs[0]).tools.some(tool => tool.name === "ae_queue_add"), false);
  assert.match(present(provider.stepInputs[0]).system, /read-only discovery/);
  await send("normal-after-bootstrap");
  assert.equal(present(provider.stepInputs.at(-1)).tools.some(tool => tool.name === "ae_ask_user"), true, "the workflow turn offers the question tool");
  assert.equal(present(provider.stepInputs.at(-1)).tools.some(tool => tool.name === "ae_select_workflow_stage"), false, "and no stage handshake");
});


test("an auto-applied seal followed by a stray queue fix is not a failed turn, through the real chat path", async (t) => {
  const rename = { type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name: "Hero" };
  const strayFix = { id: "stray-fix", name: "ae_queue_fix", arguments: { edits: [{ op: "remove", index: 0 }] } };
  const provider = new MockProvider({ script: (input) => {
    const called = input.messages.filter((message) => message.role === "tool").map((message) => message.name);
    if (!called.includes("ae_queue_add")) return { text: "", toolCalls: [{ id: "add-1", name: "ae_queue_add", arguments: { summary: "Rename to Hero", operations: [rename] } }] };
    if (!called.includes("ae_queue_finish")) return queueFinishStep("seal");
    if (!called.includes("ae_queue_fix")) return { text: "", toolCalls: [strayFix] };
    return { text: "Renamed it to Hero.", toolCalls: [] };
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("sealed-then-stray-fix")) });
  const response = await chatTurn(address, "rename this to Hero", [], { autoApply: true });
  assert.notEqual(response.outcome, "failed", JSON.stringify(response.tools));
  assert.equal(response.plans.length, 1, "the sealed batch still reaches the panel as a card");
});

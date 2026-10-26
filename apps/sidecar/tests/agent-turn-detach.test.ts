// A panel that closes the request mid-turn: a workflow job's turn detaches and finishes, a discovery turn stops, Stop still cancels, and a cancelled turn does not wait out the seal's allowance.
import { listOf, maybeTextOf, readJson, type JsonObject } from "./http-json.js";
import { authorization, pause, queueScript, sidecarFor, token, workflowStageStep } from "./sidecar-fixture.js";
import { baseUrl, cancellationReached, captureStdout, logEvents, postAbandonableChat, postSnapshot, postStop, progressForTurn, readyPlans, waitForProgress, waitForTurnEnd } from "./agent-turn-support.js";
import { toolMessages } from "./agent-test-support.js";
import { MockProvider } from "@extynt/llm";
import assert from "node:assert/strict";
import test from "node:test";

const EVENT_WAIT_ATTEMPTS = 100;
const CALL_CONTEXT = { id: "c1", name: "ae_get_current_context", arguments: {} };

test("a panel that closes the request does not end a workflow job's turn: it detaches, finishes, and logs it", async (t) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let signalAbortedAtEnd: boolean | undefined;
  const provider = new MockProvider({ script: async (input) => {
    if (toolMessages(input.messages).length === 0) { await gate; signalAbortedAtEnd = input.signal?.aborted; return { text: "", toolCalls: [CALL_CONTEXT] }; }
    return { text: "Kept working after the panel left.", toolCalls: [] };
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const lines = captureStdout(t);
  await postSnapshot(address, "probe-abandon");

  const panel = new AbortController();
  const abandoned = postAbandonableChat(address, { requestId: "chat-abandoned", message: "start something long" }, panel.signal);
  assert.ok(await waitForProgress(address, "chat-abandoned"), "the turn must be running before the panel gives up on it");
  panel.abort();
  await abandoned;
  for (let attempt = 0; attempt < EVENT_WAIT_ATTEMPTS && !lines.some((line) => line.includes("chat.client-detached")); attempt += 1) await pause(10);
  release?.();

  await waitForTurnEnd(address, "chat-abandoned");
  t.mock.restoreAll();
  const events = logEvents(lines);
  assert.equal(await progressForTurn(address, "chat-abandoned"), null, "the detached turn still ends on its own");
  assert.equal(signalAbortedAtEnd, false, "the panel's close must not abort the model request");
  assert.equal(provider.calls, 2, "the detached turn takes its next step instead of stopping");
  const detached = events.filter((entry) => entry.event === "chat.client-detached");
  assert.equal(detached.length, 1, "one detach event");
  assert.equal(detached[0]?.requestId, "chat-abandoned");
  assert.equal(typeof detached[0]?.jobId, "string");
  assert.equal(typeof detached[0]?.step, "number");
  assert.equal(events.some((entry) => entry.event === "unhandledRejection"), false);
});

test("a panel that closes a discovery-only request (no project, so no job) still stops the turn", async (t) => {
  let stoppedReachedProvider = false;
  const provider = new MockProvider({ script: async (input) => {
    if (toolMessages(input.messages).length === 0) {
      stoppedReachedProvider = await cancellationReached(input.signal);
      return { text: "", toolCalls: [CALL_CONTEXT] };
    }
    return { text: "Kept working after the panel left.", toolCalls: [] };
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const panel = new AbortController();
  const abandoned = postAbandonableChat(address, { requestId: "chat-plain", message: "what is this?" }, panel.signal);
  assert.ok(await waitForProgress(address, "chat-plain"), "the turn must be running before the panel gives up on it");
  panel.abort();
  await abandoned;
  await waitForTurnEnd(address, "chat-plain");
  assert.equal(await progressForTurn(address, "chat-plain"), null, "the abandoned turn must end rather than run on");
  assert.equal(stoppedReachedProvider, true, "the close must reach the request the turn is waiting on");
  assert.equal(provider.calls, 1, "the aborted turn must not take another step");
});

test("a detached first cycle still seals its plan and leaves the job live for the reattached panel", async (t) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const inner = queueScript("detached", "Detached");
  let first = true;
  const provider = new MockProvider({ script: async (input) => { if (first) { first = false; await gate; } return inner(input); } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  await postSnapshot(address, "detached-first-cycle");
  const panel = new AbortController();
  const abandoned = postAbandonableChat(address, { requestId: "chat-detached-seal", message: "rename this to Detached" }, panel.signal);
  assert.ok(await waitForProgress(address, "chat-detached-seal"));
  panel.abort();
  await abandoned;
  await pause(30);
  release?.();
  let ready: JsonObject[] = [];
  for (let attempt = 0; attempt < 300 && ready.length === 0; attempt += 1) {
    ready = await readyPlans(address);
    if (ready.length === 0) await pause(10);
  }
  assert.equal(ready.length, 1, "the detached turn sealed its plan for the panel to apply");
  const boot = await readJson(await fetch(`${baseUrl(address)}/v1/ui/bootstrap`, { headers: authorization }));
  const jobs = listOf(boot, "activity.jobs");
  assert.equal(jobs.length, 1, "a reloaded panel finds the job in bootstrap");
  assert.notEqual(maybeTextOf(jobs[0], "status"), undefined);
});

test("Stop still cancels a detached workflow turn", async (t) => {
  let stoppedReachedProvider = false;
  const provider = new MockProvider({ script: async (input) => {
    stoppedReachedProvider = await cancellationReached(input.signal);
    return { text: "Finished anyway.", toolCalls: [] };
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  await postSnapshot(address, "probe-detached-stop");
  const panel = new AbortController();
  const abandoned = postAbandonableChat(address, { requestId: "chat-detached-stop", message: "start something long" }, panel.signal);
  assert.ok(await waitForProgress(address, "chat-detached-stop"));
  panel.abort();
  await abandoned;
  await pause(50);
  assert.ok(await progressForTurn(address, "chat-detached-stop"), "the detached turn is still running");
  assert.equal((await postStop(address)).status, 200);
  await waitForTurnEnd(address, "chat-detached-stop");
  assert.equal(await progressForTurn(address, "chat-detached-stop"), null);
  assert.equal(stoppedReachedProvider, true, "Stop reaches the request the detached turn waits on");
});

const rename = (name: string) => ({ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name });

const sealWaitScript = (input: { messages: Parameters<typeof toolMessages>[0] }) => {
  const called = toolMessages(input.messages).map((message) => message.name);
  if (!called.includes("ae_select_workflow_stage")) return workflowStageStep("abandon");
  if (!called.includes("ae_queue_add")) return { text: "", toolCalls: [{ id: "a1", name: "ae_queue_add", arguments: { summary: "One batch", operations: [rename("Hero")] } }] };
  if (!called.includes("ae_queue_finish")) return { text: "", toolCalls: [{ id: "a2", name: "ae_queue_finish", arguments: { waitSeconds: 10 } }] };
  return { text: "Sealed it.", toolCalls: [] };
};

async function planQueued(address: Parameters<typeof readyPlans>[0]): Promise<boolean> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if ((await readyPlans(address)).length > 0) return true;
    await pause(10);
  }
  return false;
}

test("a cancelled turn does not wait out the seal's allowance", async (t) => {
  const provider = new MockProvider({ script: sealWaitScript });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  await postSnapshot(address, "probe-abandon-wait");
  const lines = captureStdout(t);

  const panel = new AbortController();
  const abandoned = postAbandonableChat(address, { requestId: "chat-abandon-wait", message: "seal it and wait for the panel", autoApply: true }, panel.signal);
  assert.ok(await waitForProgress(address, "chat-abandon-wait"), "the turn must be running before the panel gives up on it");
  assert.ok(await planQueued(address), "the sealed plan must be queued before the abort, so the turn is inside the apply wait");
  const abortedAt = Date.now();
  await postStop(address);
  panel.abort();
  await abandoned;
  await waitForTurnEnd(address, "chat-abandon-wait");
  const settledMs = Date.now() - abortedAt;
  t.mock.restoreAll();
  const logged = logEvents(lines);
  assert.equal(await progressForTurn(address, "chat-abandon-wait"), null, "the cancelled turn must end");
  assert.ok(logged.some((line) => line.event === "plan.apply-wait"), "the turn must really have been inside the post-seal wait");
  const applied = logged.filter((line) => line.event === "plan.apply-timeout" || line.event === "plan.apply-observed");
  assert.equal(applied.length, 1, "the wait ends once, whether the receipt came or the turn was cancelled");
  const waitedMs = applied[0]?.waitedMs ?? Number.POSITIVE_INFINITY;
  assert.ok(waitedMs < 2_500, `the abort must end the wait rather than the allowance: it waited ${waitedMs} ms of a 10000 ms allowance`);
  assert.ok(settledMs < 2_500, `and the turn must settle promptly after the abort, not ${settledMs} ms later`);
});

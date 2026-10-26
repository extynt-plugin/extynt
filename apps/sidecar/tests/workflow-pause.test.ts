// A job that stops at the automatic window cap is machine-readable, and a Continue for one job never resumes another.
import type { JsonValue } from "@extynt/decode";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPersistentWorkflowStore } from "@extynt/workflow";
import { MockProvider } from "@extynt/llm";
import type { DecisionModel } from "@extynt/decide";
import { WorkflowCoordinator } from "../src/workflow-coordinator.js";
import { agentReply } from "../src/server-chat-reply.js";
import type { AgentRunResult } from "../src/agent.js";
import { awaitStoppedJob, windowCapPause } from "../src/server-workflow-continuation-ownership.js";
import { cycleStopMessage } from "../src/server-workflow-cycle-budget.js";
import { blockCycleLimit } from "../src/server-workflow-cycle-effects.js";
import { mockAgentScript } from "../src/llm-mock-agent.js";
import type { ReadOnlySidecar } from "../src/server.js";
import type { WorkflowContinuationRun } from "../src/server-types.js";
import { present } from "./agent-test-support.js";
import { fieldOf, readJson } from "./http-json.js";
import { authorization, mutableSnapshot, sidecarFor, token } from "./sidecar-fixture.js";
import { freshRun } from "./workflow-cycle-fixtures.js";
import { picked, scriptedModel } from "./decision-fakes.js";

const cycleLimitMessage = (cycles: number): string => cycleStopMessage({ kind: "ceiling", cycles });

type After = { after(callback: () => void): void };
const GOAL = "Animate the persisted brief";

function persistedJobs(t: After, specs: Array<{ seed: string; blocker: string | null; cycles: number }>): { directory: string; jobIds: string[] } {
  const directory = mkdtempSync(join(tmpdir(), "ae-workflow-pause-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const coordinator = new WorkflowCoordinator({ store: createPersistentWorkflowStore({ filePath: join(directory, "workflow-store.json") }) });
  const jobIds = specs.map((spec) => {
    const jobId = coordinator.openJob(spec.seed, GOAL, { requestId: spec.seed, autoApply: true });
    for (let cycle = 1; cycle <= spec.cycles; cycle += 1) coordinator.closeProviderCycle(jobId, cycle);
    if (spec.blocker) {
      coordinator.recordProviderFailure(jobId, "WORKFLOW_CYCLE_LIMIT", "stopped", true);
      coordinator.blockJob(jobId, spec.blocker);
    }
    return jobId;
  });
  coordinator.close();
  return { directory, jobIds };
}

async function started(t: After, stateDirectory: string, cycles = 1, decisionModels?: () => ReadonlyArray<DecisionModel>): Promise<{ sidecar: ReadOnlySidecar; prompts: string[]; post: (path: string, body: JsonValue | ReturnType<typeof mutableSnapshot>) => Promise<Response>; get: (path: string) => Promise<Response> }> {
  const prompts: string[] = [];
  const provider = new MockProvider({ script: (input) => { prompts.push(JSON.stringify(input.messages)); return mockAgentScript(input); } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, workflowMaxCycles: cycles, quietAgentLog: true, stateDirectory, ...(decisionModels ? { decisionModels } : {}) });
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  const headers = { ...authorization, "content-type": "application/json", "X-AE-Panel-Instance": "pause-panel" };
  const post = (path: string, body: JsonValue | ReturnType<typeof mutableSnapshot>) => fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const get = (path: string) => fetch(`${base}${path}`, { headers });
  assert.equal((await get("/v1/pair")).status, 200);
  assert.equal((await post("/v1/snapshots", mutableSnapshot("pause-initial"))).status, 201);
  return { sidecar, prompts, post, get };
}

test("stopping at the window cap marks the result with the job and the cycles it ran, beside the human text", () => {
  const calls: string[] = [];
  const deps = { state: { workflowCoordinator: { recordProviderFailure: (jobId: string) => { calls.push(`fail:${jobId}`); }, blockJob: (_jobId: string, blocker: string) => { calls.push(`block:${blocker}`); } } } };
  const run = freshRun("job-1");
  blockCycleLimit(deps, run, { kind: "ceiling", cycles: 8 }, 8);
  const state = run.state;
  assert.deepEqual(state.aggregate?.pause, { kind: "window-cap", steps: 8, jobId: "job-1" });
  assert.equal(state.aggregate?.answer, cycleLimitMessage(8), "the text for external clients is unchanged");
  assert.match(state.aggregate?.answer ?? "", /Reply 'continue' to keep going\./u);
  assert.equal(state.aggregate?.failure?.code, "WORKFLOW_CYCLE_LIMIT");
  assert.deepEqual(calls, ["fail:job-1", "block:workflow:cycle-limit"]);
});

test("the chat reply carries the pause next to the unchanged text, and omits it on every other turn", () => {
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0 };
  const agent = (extra: Partial<AgentRunResult>): AgentRunResult => ({ outcome: "failed", notes: [], answer: cycleLimitMessage(8), plans: [], tools: [], reasoning: [], steps: 8, steering: [], usage, failure: { code: "WORKFLOW_CYCLE_LIMIT", message: cycleLimitMessage(8) }, ...extra });
  const reply = (extra: Partial<AgentRunResult>) => agentReply({ requestId: "r", message: "go" }, { agent: agent(extra), used: new MockProvider() }, {});
  const paused = reply({ pause: { kind: "window-cap", steps: 8, jobId: "job-1" } });
  assert.deepEqual(paused?.pause, { kind: "window-cap", steps: 8, jobId: "job-1" });
  assert.equal(paused?.answer, cycleLimitMessage(8));
  assert.equal("pause" in (reply({}) ?? {}), false);
});

test("a stop that no continue could resume is not marked as a pause", () => {
  assert.equal(windowCapPause(null, 8), null);
  assert.equal(windowCapPause("job-1", 1_024), null, "past the reducer's hard bound the Continue button would be dead");
  assert.deepEqual(windowCapPause("job-1", 1_023), { kind: "window-cap", steps: 1_023, jobId: "job-1" });
});

test("the status route reports the paused job, and stops once the job is resumed", async (t) => {
  const { directory, jobIds } = persistedJobs(t, [{ seed: "capped", blocker: "workflow:cycle-limit", cycles: 4 }]);
  const h = await started(t, directory);
  assert.deepEqual(fieldOf(await readJson(await h.get("/v1/workflow/status")), "pause"), { kind: "window-cap", steps: 4, jobId: jobIds[0] });
  const reply = await h.post("/v1/chat", { requestId: "go", message: "continue", continueJobId: present(jobIds[0]), autoApply: true });
  assert.equal(reply.status, 200);
  assert.notEqual(fieldOf(await readJson(reply), "failure.code"), "PAUSE_STALE");
  assert.notEqual(h.sidecar.workflowCoordinator.workflowStore.getState().jobs[present(jobIds[0])]?.blocker, "workflow:cycle-limit");
  assert.equal(fieldOf(await readJson(await h.get("/v1/workflow/status")), "pause"), null, "the job is no longer paused at the cap");
});

test("a Continue drawn for an older job never resumes the newer paused job, and a stale one refuses", async (t) => {
  const { directory, jobIds } = persistedJobs(t, [{ seed: "older", blocker: "workflow:cycle-limit", cycles: 4 }, { seed: "newer", blocker: "workflow:cycle-limit", cycles: 4 }]);
  const older = present(jobIds[0]), newer = present(jobIds[1]);
  const h = await started(t, directory);
  assert.equal(fieldOf(await readJson(await h.get("/v1/workflow/status")), "pause.jobId"), newer);
  const stale = await h.post("/v1/chat", { requestId: "stale-click", message: "continue", continueJobId: older, autoApply: true });
  assert.equal(stale.status, 200);
  assert.equal(fieldOf(await readJson(stale), "failure.code"), "PAUSE_STALE");
  const state = h.sidecar.workflowCoordinator.workflowStore.getState();
  assert.equal(state.jobs[older]?.blocker, "workflow:cycle-limit");
  assert.equal(state.jobs[newer]?.blocker, "workflow:cycle-limit", "the stale click resumed nothing");
  assert.equal(Object.keys(state.jobs).length, 2, "and it did not start a new job from the word continue");
  assert.equal(h.prompts.length, 0, "no model call was spent");
  const right = await h.post("/v1/chat", { requestId: "right-click", message: "continue", continueJobId: newer, autoApply: true });
  assert.equal(right.status, 200);
  assert.notEqual(h.sidecar.workflowCoordinator.workflowStore.getState().jobs[newer]?.blocker, "workflow:cycle-limit", "the newest job resumes when its own Continue is clicked");
  assert.equal(h.sidecar.workflowCoordinator.workflowStore.getState().jobs[older]?.blocker, "workflow:cycle-limit");
});

test("typing continue without a job id still resumes the latest paused job, and a malformed job id is refused", async (t) => {
  const { directory, jobIds } = persistedJobs(t, [{ seed: "capped", blocker: "workflow:cycle-limit", cycles: 4 }]);
  const h = await started(t, directory);
  const bad = await h.post("/v1/chat", { requestId: "bad", message: "continue", continueJobId: 7 });
  assert.equal(bad.status, 422);
  const typed = await h.post("/v1/chat", { requestId: "typed", message: "continue", autoApply: true });
  assert.equal(typed.status, 200);
  assert.notEqual(h.sidecar.workflowCoordinator.workflowStore.getState().jobs[present(jobIds[0])]?.blocker, "workflow:cycle-limit");
});

test("a message that amends and resumes continues the paused job with the amendment in its log, not a new job", async (t) => {
  const { directory, jobIds } = persistedJobs(t, [{ seed: "capped", blocker: "workflow:cycle-limit", cycles: 4 }]);
  const jev = scriptedModel(() => picked("amend-and-resume"));
  const h = await started(t, directory, 1, () => [jev.model]), jobId = present(jobIds[0]);
  const amendment = "mach weiter, aber nimm die Schrift Arial";
  const reply = await h.post("/v1/chat", { requestId: "amend", message: amendment, autoApply: true });
  assert.equal(reply.status, 200);
  const state = h.sidecar.workflowCoordinator.workflowStore.getState();
  assert.equal(Object.keys(state.jobs).length, 1, "the amendment resumed the paused job, not a new one");
  assert.notEqual(state.jobs[jobId]?.blocker, "workflow:cycle-limit");
  assert.match(h.sidecar.workflowRequestLog.text(jobId) ?? "", /Arial/);
});

function settlingRun(h: { sidecar: ReadOnlySidecar }, jobId: string, state: WorkflowContinuationRun["state"]): { finish(): void } {
  const run: WorkflowContinuationRun = { jobId, requestId: "gap", goalSummary: GOAL, autoApply: true, controller: new AbortController(), state, pendingBatchId: null, nextCycle: 4, continuation: null };
  h.sidecar.workflowRuns.set(jobId, run);
  return { finish: () => { run.state = "terminal"; } };
}

test("a continue typed while the cycle-limit run is still settling waits for it and resumes the same job", async (t) => {
  const { directory, jobIds } = persistedJobs(t, [{ seed: "capped", blocker: "workflow:cycle-limit", cycles: 4 }]);
  const h = await started(t, directory), jobId = present(jobIds[0]);
  const gap = settlingRun(h, jobId, "running");
  assert.equal(fieldOf(await readJson(await h.get("/v1/workflow/status")), "pause"), null, "inside the gap the status offers no Continue yet");
  const typed = h.post("/v1/chat", { requestId: "typed-in-gap", message: "continue", autoApply: true });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(h.sidecar.workflowCoordinator.workflowStore.getState().jobs[jobId]?.blocker, "workflow:cycle-limit", "nothing resumed while the run was still finishing");
  assert.equal(Object.keys(h.sidecar.workflowCoordinator.workflowStore.getState().jobs).length, 1, "and the word continue did not open a new job");
  gap.finish();
  const reply = await typed;
  assert.equal(reply.status, 200);
  const state = h.sidecar.workflowCoordinator.workflowStore.getState();
  assert.equal(Object.keys(state.jobs).length, 1, "the continue resumed the limit-blocked job, not a new one");
  assert.notEqual(state.jobs[jobId]?.blocker, "workflow:cycle-limit");
});

test("a continue that outlasts the settle bound refuses without starting a job", async (t) => {
  const { directory, jobIds } = persistedJobs(t, [{ seed: "capped", blocker: "workflow:cycle-limit", cycles: 4 }]);
  const h = await started(t, directory), jobId = present(jobIds[0]);
  settlingRun(h, jobId, "waiting_receipt");
  assert.deepEqual(await awaitStoppedJob(h.sidecar, "continue", 60), { kind: "unsettled" });
  assert.equal(Object.keys(h.sidecar.workflowCoordinator.workflowStore.getState().jobs).length, 1);
  assert.equal(h.prompts.length, 0, "no model call was spent");
  assert.deepEqual(await awaitStoppedJob(h.sidecar, "make it blue", 60), { kind: "none" }, "only a bare continue waits");
});

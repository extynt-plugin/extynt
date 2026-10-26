/** A job blocked by a refused completion is resumed by the user's "continue" for another completion attempt; unrelated blocks are not. */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPersistentWorkflowStore } from "@extynt/workflow";
import { MockProvider } from "@extynt/llm";
import { WorkflowCoordinator } from "../src/workflow-coordinator.js";
import { completionRefusalBlocker } from "../src/server-workflow-continuation-ownership.js";
import { mockAgentScript } from "../src/llm-mock-agent.js";
import type { ReadOnlySidecar } from "../src/server.js";
import { fieldOf, readJson } from "./http-json.js";
import type { PostBody } from "./workflow-batch-fixtures.js";
import { authorization, mutableSnapshot, sidecarFor, token } from "./sidecar-fixture.js";

type After = { after(callback: () => void | Promise<void>): void };
const GOAL = "Rename four layers";

function blockedJob(t: After, blocker: string, code: string): { directory: string; jobId: string } {
  const directory = mkdtempSync(join(tmpdir(), "ae-workflow-completion-continue-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const coordinator = new WorkflowCoordinator({ store: createPersistentWorkflowStore({ filePath: join(directory, "workflow-store.json") }) });
  const jobId = coordinator.openJob("blocked-seed", GOAL, { requestId: "blocked-seed", autoApply: true });
  for (let cycle = 1; cycle <= 2; cycle += 1) coordinator.closeProviderCycle(jobId, cycle);
  coordinator.recordProviderFailure(jobId, code, "refused", true);
  coordinator.blockJob(jobId, blocker);
  coordinator.close();
  return { directory, jobId };
}

async function started(t: After, stateDirectory: string): Promise<{ sidecar: ReadOnlySidecar; prompts: string[]; post: (path: string, body: PostBody) => Promise<Response>; get: (path: string) => Promise<Response> }> {
  const prompts: string[] = [];
  const provider = new MockProvider({ script: (input) => { prompts.push(JSON.stringify(input.messages)); return mockAgentScript(input); } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, workflowMaxCycles: 1, quietAgentLog: true, stateDirectory });
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  const headers = { ...authorization, "content-type": "application/json", "X-AE-Panel-Instance": "completion-panel" };
  const post = (path: string, body: PostBody) => fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const get = (path: string) => fetch(`${base}${path}`, { headers });
  assert.equal((await get("/v1/pair")).status, 200);
  assert.equal((await post("/v1/snapshots", mutableSnapshot("completion-initial"))).status, 201);
  return { sidecar, prompts, post, get };
}

const reopens = (h: { sidecar: ReadOnlySidecar }, jobId: string): number => h.sidecar.workflowCoordinator.workflowStore.listEvents(jobId).filter((event) => event.type === "job.reopenedForContinuation").length;

test("every code a refused completion can carry blocks the job with a blocker a continue recognises, and no other blocker is", () => {
  for (const code of ["COMPLETION_UNSUPPORTED", "COMPLETION_SNAPSHOT_UNPAIRED", "COMPLETION_UNSATISFIED", "COMPLETION_BLOCKED", "COMPLETION_TRANSITION_FAILED", "WORKFLOW_COMPLETION_REFUSED"]) {
    assert.equal(completionRefusalBlocker(`workflow:${code.toLowerCase()}`), true, code);
  }
  for (const blocker of [null, "workflow:cycle-limit", "workflow:workflow_no_batch", "workflow:workflow_completion_required", "workflow:provider-unavailable", "workflow:interrupted-before-completion", "batch:apply-failed", "workflow:completion", "completion_unsupported"]) {
    assert.equal(completionRefusalBlocker(blocker), false, String(blocker));
  }
});

for (const [blocker, code] of [["workflow:completion_unsupported", "COMPLETION_UNSUPPORTED"], ["workflow:completion_snapshot_unpaired", "COMPLETION_SNAPSHOT_UNPAIRED"]] as const) {
  test(`a continue after ${code} resumes that job for another attempt and opens no new one`, async (t) => {
    const { directory, jobId } = blockedJob(t, blocker, code);
    const h = await started(t, directory);
    assert.equal(fieldOf(await readJson(await h.get("/v1/workflow/status")), "pause"), null, "a refused completion is not offered as a step-limit pause");
    const reply = await h.post("/v1/chat", { requestId: "typed-continue", message: "continue", autoApply: true });
    assert.equal(reply.status, 200);
    const state = h.sidecar.workflowCoordinator.workflowStore.getState();
    assert.deepEqual(Object.keys(state.jobs), [jobId], "the word continue did not open a job of its own");
    assert.equal(reopens(h, jobId), 1, "the refused job was reopened once");
    assert.ok(h.prompts.length >= 1, "the resumed job spent a model cycle on the retry");
    assert.equal(state.jobs[jobId]?.goalSummary, GOAL, "with its own goal, not the word continue");
  });
}

for (const [blocker, code] of [["workflow:workflow_no_batch", "WORKFLOW_NO_BATCH"], ["workflow:provider-unavailable", "WORKFLOW_PROVIDER_UNAVAILABLE"], ["workflow:workflow_completion_required", "WORKFLOW_COMPLETION_REQUIRED"]] as const) {
  test(`a continue after the unrelated block ${blocker} still opens a new job and leaves that one blocked`, async (t) => {
    const { directory, jobId } = blockedJob(t, blocker, code);
    const h = await started(t, directory);
    const reply = await h.post("/v1/chat", { requestId: "unrelated", message: "continue", autoApply: true });
    assert.equal(reply.status, 200);
    const state = h.sidecar.workflowCoordinator.workflowStore.getState();
    assert.equal(state.jobs[jobId]?.blocker, blocker);
    assert.equal(reopens(h, jobId), 0);
    assert.ok(Object.keys(state.jobs).length >= 2, "the message started a request of its own");
  });
}

test("only a bare continue resumes a completion-refused job; any other message starts its own request", async (t) => {
  const { directory, jobId } = blockedJob(t, "workflow:completion_unsupported", "COMPLETION_UNSUPPORTED");
  const h = await started(t, directory);
  const reply = await h.post("/v1/chat", { requestId: "other", message: "make the title blue", autoApply: true });
  assert.equal(reply.status, 200);
  assert.equal(reopens(h, jobId), 0);
  assert.equal(h.sidecar.workflowCoordinator.workflowStore.getState().jobs[jobId]?.blocker, "workflow:completion_unsupported");
});

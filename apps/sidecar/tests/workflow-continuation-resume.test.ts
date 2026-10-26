// A restart or a continue resumes the jobs a stopped sidecar left behind, and only the ones that may be resumed.
import assert from "node:assert/strict";
import test from "node:test";
import { pause, mutableSnapshot } from "./sidecar-fixture.js";
import { harness, jobCount, persistedJob } from "./workflow-ownership-fixtures.js";

const PERSISTED_GOAL = "Animate the persisted brief";

test("a snapshot never auto-resumes a cycle-limit or refused-admission blocker", async (t) => {
  for (const [blocker, code] of [["workflow:cycle-limit", "WORKFLOW_CYCLE_LIMIT"], ["workflow:workflow_admission_refused", "WORKFLOW_ADMISSION_REFUSED"]] as const) {
    const { directory, jobId } = persistedJob(t, blocker, { code, message: "stopped" });
    const h = await harness(t, { stateDirectory: directory });
    await pause(300);
    const state = h.sidecar.workflowCoordinator.workflowStore.getState();
    assert.equal(state.jobs[jobId]?.status, "blocked", blocker);
    assert.equal(state.jobs[jobId]?.blocker, blocker);
    assert.equal(h.providerCalls.count, 0, `${blocker} must not spend a provider call on a snapshot`);
    assert.equal(h.sidecar.workflowRuns.size, 0);
    assert.equal(state.activeJobId, null);
    await h.sidecar.stop();
  }
});

test("a restart frees the chat lane of an interrupted job and auto-resumes it at most once", async (t) => {
  const { directory, jobId } = persistedJob(t, null);
  const h = await harness(t, { stateDirectory: directory, failEveryCall: true });
  const afterStartup = h.sidecar.workflowCoordinator.workflowStore.listEvents(jobId).find((event) => event.type === "job.blocked");
  assert.ok(afterStartup, "construction blocks the interrupted job so the chat lane is not held");
  assert.equal(await h.sidecar.waitUntil(() => h.providerCalls.count >= 1, 2), true, "the first snapshot after startup resumes the interrupted job");
  assert.equal(h.sidecar.autoResumedWorkflowJobs.has(jobId), true);
  await pause(200);
  const settledCalls = h.providerCalls.count;
  for (const index of [1, 2]) assert.equal((await h.post("/v1/snapshots", mutableSnapshot(`resume-again-${index}`, ["layer-1"], "Hero"))).status, 201);
  await pause(300);
  assert.equal(h.providerCalls.count, settledCalls, "later snapshots never resume the same job again in this process");
});

test("a bare continue after the automatic cycle limit resumes the same job with its goal and a fresh window budget", async (t) => {
  for (const message of ["continue", "  Continue.  ", "Keep going!", "go on", "resume"]) {
    const { directory, jobId } = persistedJob(t, "workflow:cycle-limit", { code: "WORKFLOW_CYCLE_LIMIT", message: "stopped" }, 4);
    const h = await harness(t, { stateDirectory: directory, cycles: 1 });
    assert.equal(h.sidecar.workflowCoordinator.workflowStore.getState().jobs[jobId]?.providerCycle, 4);
    const reply = await h.post("/v1/chat", { requestId: `continue-${message.trim().length}`, message, autoApply: true });
    assert.equal(reply.status, 200, message);
    assert.equal(jobCount(h), 1, `${message}: the same job continues instead of opening a new one`);
    const job = h.sidecar.workflowCoordinator.workflowStore.getState().jobs[jobId];
    assert.notEqual(job?.blocker, "workflow:cycle-limit", message);
    assert.ok((job?.providerCycle ?? 0) > 4, `${message}: the resumed job spends new cycles`);
    assert.equal(h.sidecar.workflowCycleBudgetBase.get(jobId), 4, "the automatic window budget counts from the cycle the user resumed at");
    assert.ok(h.providerCalls.prompts[0]?.includes(PERSISTED_GOAL), `${message}: the model is briefed with the original goal, not the word "continue"`);
    assert.equal(h.sidecar.workflowCoordinator.workflowStore.listEvents(jobId).filter((event) => event.type === "job.reopenedForContinuation").length, 1);
    await h.sidecar.stop();
  }
});

test("a continuation request never resumes a job blocked for another reason, and other messages never resume a cycle-limited job", async (t) => {
  const cases: Array<{ blocker: string; message: string }> = [
    { blocker: "workflow:provider-unavailable", message: "continue" },
    { blocker: "workflow:workflow_admission_refused", message: "continue" },
    { blocker: "workflow:cycle-limit", message: "make the title blue" },
    { blocker: "workflow:cycle-limit", message: "continue the animation but make it blue" },
    { blocker: "workflow:cycle-limit", message: "" + "continue ".repeat(20) },
  ];
  for (const { blocker, message } of cases) {
    const { directory, jobId } = persistedJob(t, blocker, { code: "STOPPED", message: "stopped" }, 4);
    const h = await harness(t, { stateDirectory: directory, cycles: 1 });
    const reply = await h.post("/v1/chat", { requestId: "not-a-resume", message, autoApply: true });
    assert.equal(reply.status, 200, `${blocker} / ${message}`);
    const state = h.sidecar.workflowCoordinator.workflowStore.getState();
    assert.equal(state.jobs[jobId]?.status, "blocked", `${blocker} / ${message}: the old job stays blocked`);
    assert.equal(state.jobs[jobId]?.blocker, blocker);
    assert.equal(state.jobs[jobId]?.providerCycle, 4);
    assert.equal(jobCount(h), 2, `${blocker} / ${message}: the message starts a new job`);
    assert.equal(h.sidecar.workflowCycleBudgetBase.has(jobId), false);
    assert.equal(h.providerCalls.prompts.some((prompt) => prompt.includes(PERSISTED_GOAL)), false, "the old goal is never carried into an unrelated request");
    await h.sidecar.stop();
  }
});

test("only the most recent job can be resumed by continue", async (t) => {
  const { directory, jobId } = persistedJob(t, "workflow:cycle-limit", { code: "WORKFLOW_CYCLE_LIMIT", message: "stopped" }, 4);
  const h = await harness(t, { stateDirectory: directory, cycles: 1 });
  assert.equal((await h.post("/v1/chat", { requestId: "newer-work", message: "summarize the selected project", autoApply: true })).status, 200);
  assert.equal(jobCount(h), 2);
  const reply = await h.post("/v1/chat", { requestId: "late-continue", message: "continue", autoApply: true });
  assert.equal(reply.status, 200);
  const state = h.sidecar.workflowCoordinator.workflowStore.getState();
  assert.equal(state.jobs[jobId]?.blocker, "workflow:cycle-limit", "an older limit-blocked job is not revived by a later continue");
});

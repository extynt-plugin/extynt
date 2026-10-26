/** Stop always stops: the job in whatever state it is in, the turn that works on it (also a resumed one), and one logged event. */
import { decodeOrThrow, jsonValue, type JsonValue } from "@extynt/decode";
import assert from "node:assert/strict";
import test from "node:test";
import { activityViewOf } from "../src/server-activity.js";
import type { ReadOnlySidecar } from "../src/server.js";
import { fieldOf, parseJson } from "./http-json.js";
import { raw, startUiSidecar } from "./ui-fixture.js";

type Run = ReadOnlySidecar["workflowRuns"] extends Map<string, infer R> ? R : never;
type RunState = Run["state"];
type LogFields = Parameters<ReadOnlySidecar["eventLog"]>[1];

function openJob(sidecar: ReadOnlySidecar, seed: string, run?: RunState): { jobId: string; controller: AbortController } {
  const jobId = sidecar.workflowCoordinator.openJob(seed, "Build the title card", { requestId: seed, autoApply: true });
  const controller = new AbortController();
  if (run) sidecar.workflowRuns.set(jobId, { jobId, requestId: seed, goalSummary: "Build the title card", autoApply: true, controller, state: run, pendingBatchId: null, nextCycle: 3, continuation: null });
  return { jobId, controller };
}

function openTurn(sidecar: ReadOnlySidecar, requestId: string, jobId?: string): AbortController {
  const controller = new AbortController();
  sidecar.activeChatTurn = { requestId, controller, startedAt: Date.now(), settled: new Promise<void>(() => undefined), ...(jobId ? { jobId } : {}) };
  return controller;
}

function logged(sidecar: ReadOnlySidecar): Array<{ event: string; fields: LogFields }> {
  const events: Array<{ event: string; fields: LogFields }> = [];
  sidecar.eventLog = (event, fields) => { events.push({ event, fields }); };
  return events;
}

const post = (port: number, path: string) => raw(port, { method: "POST", path, authorized: true, headers: { host: `127.0.0.1:${port}` } });
const bodyOf = (response: { text: string }): JsonValue => decodeOrThrow(jsonValue, parseJson(response.text));
const statusOf = (sidecar: ReadOnlySidecar, jobId: string) => sidecar.workflowCoordinator.workflowStore.getState().jobs[jobId]?.status;

test("Stop while a turn runs aborts the turn and cancels its job", async (t) => {
  const { sidecar, port } = await startUiSidecar(t);
  const { jobId } = openJob(sidecar, "req-1");
  const turn = openTurn(sidecar, "req-1");
  const events = logged(sidecar);
  const stopped = await post(port, `/v1/ui/jobs/${jobId}/stop`);
  assert.equal(stopped.status, 200, stopped.text);
  assert.equal(fieldOf(bodyOf(stopped), "outcome"), "stopped");
  assert.equal(turn.signal.aborted, true);
  assert.equal(statusOf(sidecar, jobId), "cancelled");
  assert.deepEqual(events.map((entry) => [entry.event, entry.fields.jobId, entry.fields.outcome, entry.fields.turnAborted]), [["job.stop", jobId, "stopped", true]]);
});

test("Stop reaches a resumed turn whose request id is not the job's seed", async (t) => {
  const { sidecar, port } = await startUiSidecar(t);
  const { jobId } = openJob(sidecar, "req-1");
  const byRecordedJob = openTurn(sidecar, "req-continue-1", jobId);
  assert.equal((await post(port, `/v1/ui/jobs/${jobId}/stop`)).status, 200);
  assert.equal(byRecordedJob.signal.aborted, true);
  const second = openJob(sidecar, "req-2", "running");
  const byRun = openTurn(sidecar, "req-2");
  assert.equal((await post(port, `/v1/ui/jobs/${second.jobId}/stop`)).status, 200);
  assert.equal(byRun.signal.aborted, true);
  assert.equal(second.controller.signal.aborted, true);
});

function assertRunSettled(sidecar: ReadOnlySidecar, job: { jobId: string; controller: AbortController }, run: RunState | undefined): void {
  if (run && run !== "terminal") assert.equal(job.controller.signal.aborted, true, String(run));
  if (run) assert.equal(sidecar.workflowRuns.get(job.jobId)?.state, "terminal", String(run));
}

async function stopBetweenCycles(t: Parameters<typeof startUiSidecar>[0], run: RunState | undefined): Promise<void> {
  const { sidecar, port } = await startUiSidecar(t);
  const job = openJob(sidecar, `req-${run ?? "none"}`, run);
  const { jobId } = job;
  sidecar.workflowCoordinator.blockJob(jobId, "workflow:cycle-limit");
  if (run === "scheduled") sidecar.workflowContinuationQueue.add(jobId);
  const events = logged(sidecar);
  const stopped = await post(port, `/v1/ui/jobs/${jobId}/stop`);
  assert.equal(stopped.status, 200, `${run}: ${stopped.text}`);
  assert.equal(fieldOf(bodyOf(stopped), "outcome"), "stopped", String(run));
  assert.equal(statusOf(sidecar, jobId), "cancelled", String(run));
  assert.equal(sidecar.workflowContinuationQueue.has(jobId), false, String(run));
  assertRunSettled(sidecar, job, run);
  assert.deepEqual(activityViewOf(sidecar).jobs, []);
  assert.equal(events[0]?.event, "job.stop");
  assert.match(String(events[0]?.fields.prior), /^blocked\//);
}

test("Stop between cycles cancels a blocked, waiting or scheduled job so nothing relaunches it", async (t) => {
  for (const run of ["waiting_receipt", "scheduled", "terminal", undefined] as const) await stopBetweenCycles(t, run);
});

test("Stop with no job id ends the open turn and every live job", async (t) => {
  const { sidecar, port } = await startUiSidecar(t);
  const { jobId } = openJob(sidecar, "req-1", "running");
  const turn = openTurn(sidecar, "req-1");
  const events = logged(sidecar);
  const stopped = await post(port, "/v1/ui/stop");
  assert.equal(stopped.status, 200, stopped.text);
  assert.equal(fieldOf(bodyOf(stopped), "jobId"), jobId);
  assert.equal(turn.signal.aborted, true);
  assert.equal(statusOf(sidecar, jobId), "cancelled");
  assert.equal(events[0]?.fields.requested, false);
});

test("Stop with no job id aborts a turn that has no job", async (t) => {
  const { sidecar, port } = await startUiSidecar(t);
  const turn = openTurn(sidecar, "req-read-only");
  assert.equal(fieldOf(bodyOf(await post(port, "/v1/ui/stop")), "outcome"), "stopped");
  assert.equal(turn.signal.aborted, true);
});

test("Stop is idempotent and says so when there is nothing to stop", async (t) => {
  const { sidecar, port } = await startUiSidecar(t);
  const { jobId } = openJob(sidecar, "req-1", "running");
  await post(port, `/v1/ui/jobs/${jobId}/stop`);
  const again = await post(port, `/v1/ui/jobs/${jobId}/stop`);
  assert.equal(again.status, 200, again.text);
  assert.equal(fieldOf(bodyOf(again), "outcome"), "already-finished");
  const idle = await post(port, "/v1/ui/stop");
  assert.equal(idle.status, 200);
  assert.equal(fieldOf(bodyOf(idle), "outcome"), "nothing-running");
  const unknown = await post(port, "/v1/ui/jobs/wf-job-unknown/stop");
  assert.equal(fieldOf(bodyOf(unknown), "outcome"), "nothing-running");
});

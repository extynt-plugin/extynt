/** ADR 0044: the sidecar reports what it did for the model, once, across boundaries, and rechecks when it matters. */
import assert from "node:assert/strict";
import test from "node:test";
import type { WorkflowId } from "@extynt/workflow";
import { workflowCycleInput } from "../src/server-workflow-cycle-brief.js";
import { carryFeedback, clearRecheck, drainSidecarActions, MAX_LEDGER_LINES, noteModelLooked, pendingRecheck, recordSidecarAction, requestRecheck, sidecarActionsText, takeCarriedFeedback, type SidecarActionHost, type SidecarActionLedger } from "../src/server-workflow-sidecar-actions.js";

const JOB: WorkflowId = "job-1";
const host = (freeRun = true): SidecarActionHost => ({ workflowSidecarActions: new Map<WorkflowId, SidecarActionLedger>(), options: { workflowFreeRun: freeRun } });

function cycleInput(notes: string | undefined, recheck?: string) {
  const turn = { requestId: "r", message: "build it", history: [], autoApply: true };
  return workflowCycleInput({ turn, seed: "seed", cycle: 3, goal: "goal", continuation: null, orchestration: undefined, admissionRefusal: undefined, ...(notes ? { notes } : {}), ...(recheck ? { recheck } : {}) });
}

test("sidecar actions: each line is delivered exactly once", () => {
  const h = host();
  recordSidecarAction(h, JOB, "sealed batch b12 (8 ops, design build 3 of 5), verified");
  recordSidecarAction(h, JOB, "took a frame");
  assert.deepEqual(drainSidecarActions(h, JOB), ["sealed batch b12 (8 ops, design build 3 of 5), verified", "took a frame"]);
  assert.deepEqual(drainSidecarActions(h, JOB), []);
  recordSidecarAction(h, JOB, "queued held animation");
  assert.deepEqual(drainSidecarActions(h, JOB), ["queued held animation"]);
});

test("sidecar actions: the ledger is bounded and only free run keeps one", () => {
  const h = host();
  for (let index = 0; index < MAX_LEDGER_LINES + 5; index += 1) recordSidecarAction(h, JOB, `line ${index}`);
  const lines = drainSidecarActions(h, JOB);
  assert.equal(lines.length, MAX_LEDGER_LINES);
  assert.equal(lines[0], "line 5");
  const off = host(false);
  recordSidecarAction(off, JOB, "ignored");
  assert.deepEqual(drainSidecarActions(off, JOB), []);
});

test("sidecar actions: unread lines survive the window boundary and reach the next cycle's message once", () => {
  const h = host();
  recordSidecarAction(h, JOB, "the 6-cycle authoring window ended at cycle 6");
  recordSidecarAction(h, JOB, "sealed the 4 held animation operations it queued for you");
  const first = cycleInput(sidecarActionsText(drainSidecarActions(h, JOB)));
  assert.match(first.message, /sealed the 4 held animation operations/);
  assert.match(first.message, /authoring window ended/);
  assert.deepEqual(drainSidecarActions(h, JOB), [], "told once");
});

test("sidecar actions: feedback for a cycle that never started survives the window boundary", () => {
  const h = host();
  carryFeedback(h, JOB, "Your cycle ended without ae_workflow_complete, so the job is still open.");
  assert.equal(takeCarriedFeedback(h, JOB), "Your cycle ended without ae_workflow_complete, so the job is still open.");
  assert.equal(takeCarriedFeedback(h, JOB), undefined, "taken once");
  assert.match(cycleInput("Your cycle ended without ae_workflow_complete, so the job is still open.").message, /still open/);
});

test("sidecar actions: two sidecar-sealed batches since the model looked trigger a recheck cycle", () => {
  const h = host();
  recordSidecarAction(h, JOB, "built and sealed the next design group (a)", { visual: true });
  assert.equal(pendingRecheck(h, JOB), undefined, "one batch with visual coverage is not enough");
  recordSidecarAction(h, JOB, "built and sealed the next design group (b)", { visual: true });
  const reason = pendingRecheck(h, JOB);
  assert.match(reason ?? "", /sealed 2 batches/);
  const input = cycleInput(undefined, reason);
  assert.equal(input.workflowObservationOnly, true);
  assert.match(input.message, /read-only observation cycle/);
  assert.match(input.message, /sidecar is rechecking/);
  clearRecheck(h, JOB);
  assert.equal(pendingRecheck(h, JOB), undefined);
});

test("sidecar actions: one sidecar-sealed batch without visual coverage rechecks, and the model looking resets it", () => {
  const h = host();
  recordSidecarAction(h, JOB, "built and sealed the next design group", { visual: false });
  assert.match(pendingRecheck(h, JOB) ?? "", /no visual coverage/);
  noteModelLooked(h, JOB);
  assert.equal(pendingRecheck(h, JOB), undefined);
});

test("sidecar actions: an uncertain state is a recheck, not a retry, and the message says so", () => {
  const h = host();
  requestRecheck(h, JOB, "the last batch settled unknown/unknown, so what it left in After Effects is uncertain");
  const reason = pendingRecheck(h, JOB);
  assert.ok(reason);
  const input = cycleInput("Your previous cycle was stopped by the sidecar.", reason);
  assert.equal(input.workflowObservationOnly, true);
  assert.match(input.message, /uncertain/);
  assert.match(input.message, /Do not replay or correct mutations/);
  const off = host(false);
  requestRecheck(off, JOB, "x");
  assert.equal(pendingRecheck(off, JOB), undefined);
});

test("sidecar actions: a coverage or repair cycle outranks a recheck", () => {
  const input = workflowCycleInput({ turn: { requestId: "r", message: "m", history: [], autoApply: true }, seed: "s", cycle: 3, goal: "g", continuation: null, orchestration: undefined, admissionRefusal: undefined, coverage: ["a glow"], recheck: "x" });
  assert.equal(input.workflowObservationOnly, undefined);
  assert.match(input.message, /build cycle/);
});

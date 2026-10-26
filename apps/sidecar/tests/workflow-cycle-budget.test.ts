/** The automatic cycle budget: a job that lands work runs on, a stalled one pauses, and the ceiling, clock and hard limit stop a long go-ahead. */
import assert from "node:assert/strict";
import test from "node:test";
import { AUTOMATIC_CYCLE_CEILING, AUTOMATIC_WALL_CLOCK_MS, STALL_CYCLES, STALL_FEEDBACK_CYCLES, automaticCycleStop, cycleStopMessage, stalledCycles, type CycleBudgetState, type ProgressMark, type ProgressView } from "../src/server-workflow-cycle-budget.js";

function budget(): { state: CycleBudgetState; land(): void; advance(ms: number): void } {
  let applied = 0, clock = 0;
  const store = (): ProgressView => {
    const batchIds = Array.from({ length: applied }, (_, i) => `batch-${i}`);
    const batches = Object.fromEntries(batchIds.map((id) => [id, { execution: { mutation: "applied" }, verification: { state: "verified" } }]));
    return { jobs: { "job-1": { batchIds, stageIds: [] } }, batches, stages: {} };
  };
  const state: CycleBudgetState = { workflowProgressMarks: new Map<string, ProgressMark>(), now: () => new Date(clock), workflowCycleCeiling: AUTOMATIC_CYCLE_CEILING, workflowCoordinator: { workflowStore: { getState: store } } };
  return { state, land: () => { applied += 1; }, advance: (ms) => { clock += ms; } };
}

test("a job that keeps landing work is never stopped for its length", () => {
  const { state, land } = budget();
  for (let cycle = 1; cycle < AUTOMATIC_CYCLE_CEILING; cycle += 1) {
    land();
    assert.equal(automaticCycleStop(state, "job-1", cycle), null, `cycle ${cycle}`);
  }
});

test("a job that lands nothing pauses after the stall allowance, and new work resets the count", () => {
  const { state, land } = budget();
  for (let cycle = 1; cycle < STALL_CYCLES; cycle += 1) assert.equal(automaticCycleStop(state, "job-1", cycle), null);
  land();
  assert.equal(automaticCycleStop(state, "job-1", STALL_CYCLES), null, "landed work resets the stall count");
  assert.deepEqual(automaticCycleStop(state, "job-1", 2 * STALL_CYCLES), { kind: "stalled", cycles: STALL_CYCLES });
});

test("the cycle ceiling and wall clock pause a long go-ahead to check in; the hard bound ends it", () => {
  const a = budget();
  assert.equal(automaticCycleStop(a.state, "job-1", 1), null);
  a.land();
  assert.deepEqual(automaticCycleStop(a.state, "job-1", 1 + AUTOMATIC_CYCLE_CEILING), { kind: "ceiling", cycles: AUTOMATIC_CYCLE_CEILING }, "even a job still landing work checks in at the ceiling");
  const b = budget();
  automaticCycleStop(b.state, "job-1", 1);
  b.land(); b.advance(AUTOMATIC_WALL_CLOCK_MS);
  assert.deepEqual(automaticCycleStop(b.state, "job-1", 2), { kind: "clock", cycles: 1 });
  assert.equal(automaticCycleStop(budget().state, "job-1", 1_024)?.kind, "hard");
});

test("the model is told at STALL_FEEDBACK_CYCLES, before the pause at STALL_CYCLES, and landed work resets the count", () => {
  const { state, land } = budget();
  assert.equal(STALL_FEEDBACK_CYCLES < STALL_CYCLES, true);
  automaticCycleStop(state, "job-1", 1);
  for (let cycle = 2; cycle <= STALL_FEEDBACK_CYCLES; cycle += 1) automaticCycleStop(state, "job-1", cycle);
  assert.equal(stalledCycles(state, "job-1", STALL_FEEDBACK_CYCLES), STALL_FEEDBACK_CYCLES - 1);
  land();
  automaticCycleStop(state, "job-1", STALL_FEEDBACK_CYCLES + 1);
  assert.equal(stalledCycles(state, "job-1", STALL_FEEDBACK_CYCLES + 1), 0);
});

test("a pause says it can be resumed with continue; the wall clock and hard limit are stops that name the limit", () => {
  for (const kind of ["stalled", "ceiling"] as const) assert.match(cycleStopMessage({ kind, cycles: 8 }), /paused.*'continue'/s);
  assert.match(cycleStopMessage({ kind: "clock", cycles: 8 }), /6-hour wall-clock limit/);
  assert.match(cycleStopMessage({ kind: "hard", cycles: 1_024 }), /hard limit of 1024/);
});

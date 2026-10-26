/** Whether Undo stays offered once AE's revision has moved off the one the apply left: it does when a read taken at the live revision shows the project as the apply left it. */
import { ACTION_PLAN_SCHEMA, type ActionPlan } from "@extynt/action-plan";
import type { StoredPlan } from "@extynt/mcp-server";
import assert from "node:assert/strict";
import test from "node:test";
import { changeHistory, type ChangeFacts } from "../src/server-change-history.js";

const project = { name: "Fixture", filePath: null };
const stamp = (revision: number) => ({ epoch: 1, revision });
const plan: ActionPlan = { schemaVersion: ACTION_PLAN_SCHEMA, planId: "p1", summary: "Change p1", snapshotFingerprint: "fp-0", operations: [], requiresApproval: true };
const applied: StoredPlan = {
  plan, status: "verified", project, createdAt: "2026-10-01T12:00:00.000Z", updatedAt: "2026-10-01T12:00:00.000Z",
  receipt: { planId: "p1", operation: "apply_plan", status: "executed", receivedAt: "2026-10-01T12:00:00.000Z", mayHaveMutated: true, afterFingerprint: "fp-after" },
};

function undoOf(facts: Pick<ChangeFacts, "readAt">, currentFingerprint: string) {
  const full: ChangeFacts = { afterStamps: new Map([["p1", stamp(10)]]), live: stamp(12), ...facts };
  return changeHistory({ plans: new Map([["p1", applied]]), project, currentFingerprint, facts: full }).changes[0]?.undo;
}

test("a revision that moved and came back to the project the apply left still offers Undo, once a read at that revision shows it", () => {
  assert.deepEqual(undoOf({ readAt: stamp(12) }, "fp-after"), { available: true });
});

test("a revision that moved with a different project is refused", () => {
  assert.deepEqual(undoOf({ readAt: stamp(12) }, "fp-edited"), { available: false, code: "UNDO_PROJECT_CHANGED", reason: "the project changed after this was applied" });
});

test("a revision that moved before any read has seen it is refused: the last read cannot vouch for the project now", () => {
  const undo = undoOf({ readAt: stamp(10) }, "fp-after");
  assert.deepEqual(undo, { available: false, code: "UNDO_PROJECT_CHANGED", reason: "the project changed after this was applied" });
  assert.equal(undoOf({}, "fp-after")?.available, false);
});

test("a revision that did not move offers Undo whatever the last read says about the stamp", () => {
  const facts: ChangeFacts = { afterStamps: new Map([["p1", stamp(10)]]), live: stamp(10) };
  assert.deepEqual(changeHistory({ plans: new Map([["p1", applied]]), project, currentFingerprint: "fp-after", facts }).changes[0]?.undo, { available: true });
});

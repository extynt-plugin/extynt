/** A plan is current while the project is at the revision it was made at, even when the two reads fingerprint differently; any other move is drift. */
import { ACTION_PLAN_SCHEMA, type ActionPlan } from "@extynt/action-plan";
import type { StoredPlan } from "@extynt/mcp-server";
import { representativeSnapshot, type ProjectSnapshot } from "@extynt/project-graph";
import assert from "node:assert/strict";
import test from "node:test";
import { planDrifted } from "../src/server-apply-admission.js";

const base = representativeSnapshot;
const project = { name: base.project.name, filePath: base.project.filePath };
const freshness = { revision: "9228", capturedAt: "2026-10-05T10:00:00.000Z", receivedAt: null };

const plan: ActionPlan = { schemaVersion: ACTION_PLAN_SCHEMA, planId: "p1", summary: "Change", snapshotFingerprint: "fp-plan", selectionFingerprint: base.selectionFingerprint, freshness, operations: [], requiresApproval: true };
const record: StoredPlan = { plan, status: "approved", project, createdAt: freshness.capturedAt, updatedAt: freshness.capturedAt };

const read = (over: Partial<ProjectSnapshot> = {}): ProjectSnapshot => ({ ...base, fingerprint: "fp-plan", hostStamp: { epoch: 1, revision: 9228 }, freshness, ...over });

const unstamped = (over: Partial<ProjectSnapshot> = {}): ProjectSnapshot => { const snapshot = read(over); delete snapshot.hostStamp; return snapshot; };

test("a plan whose fingerprint matches and whose revision has not moved is current", () => {
  assert.equal(planDrifted(record, read()), false);
});

test("a different fingerprint at the revision the plan was made at is not drift: nothing was edited", () => {
  assert.equal(planDrifted(record, read({ fingerprint: "fp-thinner-read" })), false);
});

test("a different fingerprint at a different revision is drift", () => {
  assert.equal(planDrifted(record, read({ fingerprint: "fp-edited", freshness: { ...freshness, revision: "9230" } })), true);
});

test("the revision only counts for a read the host stamped, in the same project", () => {
  assert.equal(planDrifted(record, unstamped({ fingerprint: "fp-other" })), true, "a probe read's revision is not an edit counter");
  assert.equal(planDrifted(record, read({ fingerprint: "fp-other", project: { name: "Elsewhere.aep", filePath: "/tmp/Elsewhere.aep" } })), true);
});

test("a changed selection is drift whatever the revision says", () => {
  assert.equal(planDrifted(record, read({ selectionFingerprint: "sel-moved" })), true);
});

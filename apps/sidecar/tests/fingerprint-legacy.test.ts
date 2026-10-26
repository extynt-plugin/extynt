/** A fingerprint persisted in the earlier 8-digit form is stale after the upgrade: refused or reported, never matched and never a crash. */
import { ACTION_PLAN_SCHEMA, type ActionPlan } from "@extynt/action-plan";
import type { StoredPlan } from "@extynt/mcp-server";
import { graphFingerprint, representativeSnapshot, selectionFingerprint } from "@extynt/project-graph";
import assert from "node:assert/strict";
import test from "node:test";
import { precheckAdmission } from "../src/apply-precheck.js";
import { changeHistory } from "../src/server-change-history.js";

const LEGACY = "cf49f7fc";
const current = { fingerprint: graphFingerprint(representativeSnapshot), selectionFingerprint: selectionFingerprint(representativeSnapshot) };

test("a plan made before the upgrade is refused at the precheck as stale, with the reason", () => {
  const verdict = precheckAdmission({ snapshotFingerprint: LEGACY, selectionFingerprint: "abcd1234" }, current);
  assert.equal(verdict.ok, false); assert.equal(!verdict.ok && verdict.code, "STALE_SNAPSHOT");
  assert.match(!verdict.ok ? verdict.text : "", /earlier version of extynt/); assert.match(!verdict.ok ? verdict.text : "", /nothing was run/);
});

test("a plan made under the previous fingerprint version (list order read as content) is stale with the same reason, not a silent mismatch", () => {
  const verdict = precheckAdmission({ snapshotFingerprint: "fp2-8d3e2c3c0123456789abcdef01234567", selectionFingerprint: current.selectionFingerprint }, current);
  assert.equal(!verdict.ok && verdict.code, "STALE_SNAPSHOT"); assert.match(!verdict.ok ? verdict.text : "", /earlier version of extynt/);
});

test("a legacy selection fingerprint alone is stale too", () => {
  const verdict = precheckAdmission({ snapshotFingerprint: current.fingerprint, selectionFingerprint: "abcd1234" }, current);
  assert.equal(!verdict.ok && verdict.code, "STALE_SNAPSHOT");
});

test("a plan bound to the current fingerprints is still admitted", () => {
  assert.deepEqual(precheckAdmission({ snapshotFingerprint: current.fingerprint, selectionFingerprint: current.selectionFingerprint }, current), { ok: true });
});

const project = { name: "Fixture", filePath: null };
const plan: ActionPlan = { schemaVersion: ACTION_PLAN_SCHEMA, planId: "kept", summary: "Kept from before", snapshotFingerprint: LEGACY, operations: [], requiresApproval: true };
const kept: StoredPlan = { plan, status: "verified", project, createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z", receipt: { planId: "kept", operation: "apply_plan", status: "executed", receivedAt: "2026-10-01T10:00:00.000Z", mayHaveMutated: true, afterFingerprint: LEGACY, appliedOperations: [] } };

test("the history of a legacy-fingerprinted change reports the project as moved on, so Undo is not offered on a state nothing can vouch for", () => {
  const listed = changeHistory({ plans: new Map([["kept", kept]]), project, currentFingerprint: current.fingerprint });
  assert.equal(listed.changes.length, 1);
  assert.deepEqual(listed.changes[0]?.undo, { available: false, code: "UNDO_PROJECT_CHANGED", reason: "the project changed after this was applied" });
});

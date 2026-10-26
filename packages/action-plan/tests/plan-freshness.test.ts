// Plan freshness and approval: a plan is current against its snapshot, expires, and binds a one-time capability to its own content.
import assert from "node:assert/strict";
import test from "node:test";
import { representativeSnapshot, type ProjectSnapshot } from "@extynt/project-graph";
import { type JsonObject } from "@extynt/decode";
import { bindApproval, issueApproval, validateActionPlanJson } from "../src/index.js";
import { nativeWrite, OPACITY_PATH, target } from "./fixtures.js";
import { acceptedPlan, buildPlan, refusal } from "./plan-builders.js";

const rename = { type: "set_layer_name", target, name: "x" } satisfies JsonObject;
const ISSUED = "2026-09-11T12:00:00.000Z";

function codeAgainst(snapshot: ProjectSnapshot): string {
  const result = validateActionPlanJson(buildPlan({ operations: [rename] }), snapshot);
  return result.ok ? "ok" : result.code;
}

test("a rename plan is accepted against the current snapshot", () => {
  assert.equal(codeAgainst(representativeSnapshot), "ok");
});

test("a moved selection is stale", () => {
  const moved = { ...representativeSnapshot, selection: { compositionId: "comp-main", layerIds: [] }, selectionFingerprint: "different-selection" };
  assert.equal(codeAgainst(moved), "STALE_SELECTION");
});

test("a changed graph is stale", () => {
  assert.equal(codeAgainst({ ...representativeSnapshot, fingerprint: "different-graph" }), "STALE_SNAPSHOT");
});

test("an expired plan is refused before approval", () => {
  assert.equal(refusal([rename], { fields: { expiresAt: "2020-01-01T00:00:00.000Z" } }).code, "APPROVAL_EXPIRED");
});

test("an issued capability is one-time and bound to the plan's digest", () => {
  const plan = acceptedPlan([rename]);
  const capability = issueApproval({ plan, snapshot: representativeSnapshot, panelSessionId: "panel-session", now: ISSUED });
  assert.ok("token" in capability);
  assert.equal(capability.oneTime, true);
  assert.equal(capability.planDigest, plan.digest);
  assert.equal("approvalId" in bindApproval(plan, representativeSnapshot, capability, "2026-09-11T12:01:00.000Z"), true);
});

test("an expired capability cannot bind", () => {
  const plan = acceptedPlan([rename]);
  const capability = issueApproval({ plan, snapshot: representativeSnapshot, panelSessionId: "panel-session", now: ISSUED });
  assert.ok("token" in capability);
  const late = bindApproval(plan, representativeSnapshot, capability, "2026-09-11T12:10:00.000Z");
  assert.equal("code" in late && late.code, "APPROVAL_EXPIRED");
});

test("a foreign capability cannot bind", () => {
  const plan = acceptedPlan([rename]);
  const capability = issueApproval({ plan, snapshot: representativeSnapshot, panelSessionId: "panel-session", now: ISSUED });
  assert.ok("token" in capability);
  const forged = bindApproval(plan, representativeSnapshot, { ...capability, planId: "someone-else" }, "2026-09-11T12:01:00.000Z");
  assert.equal("code" in forged && forged.code, "APPROVAL_MISMATCH");
});

test("an approval binds the plan's content: a different plan under the same id cannot reuse it", () => {
  const plan = acceptedPlan([nativeWrite("transform.opacity", OPACITY_PATH, 50)]);
  const now = new Date().toISOString();
  const capability = issueApproval({ plan, snapshot: representativeSnapshot, panelSessionId: "panel-session", now: now });
  assert.ok("token" in capability);
  assert.equal(capability.planDigest, plan.digest);
  assert.equal("approvalId" in bindApproval(plan, representativeSnapshot, capability, now), true);
  const swapped = acceptedPlan([nativeWrite("transform.opacity", OPACITY_PATH, 0)]);
  assert.equal(swapped.planId, plan.planId);
  const refused = bindApproval(swapped, representativeSnapshot, capability, now);
  assert.equal("code" in refused ? refused.code : "bound", "APPROVAL_MISMATCH");
});

test("a target in the open composition that the snapshot has not read says so", () => {
  const snapshot = { ...representativeSnapshot, activeCompositionId: "229" };
  const message = refusal([{ type: "set_layer_name", target: { ...target, compositionId: "229" }, name: "Hero" }], { snapshot });
  assert.equal(message.code, "TARGET_NOT_FOUND");
  assert.match(message.message, /Composition 229 is open in After Effects but has not been read yet/);
  assert.match(message.message, /ae_refresh_snapshot/);
});

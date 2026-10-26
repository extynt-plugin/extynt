// Tests that render destinations are checked against the path policy when proposed, amended and approved, and that symlinks and network shares are judged by where they land.
import test from "node:test";
import assert from "node:assert/strict";
import { representativeSnapshot } from "@extynt/project-graph";
import { BASE_CATALOGUE } from "@extynt/capability-catalogue";
import { callTool, type StoredPlan } from "../src/index.js";
import { stringAt } from "../src/json.js";
import { refusalOf, resultData } from "./support/json-results.js";
import { pathPolicyProblem } from "../src/path-policy.js";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { VERIFIED_HOST, RENDER_OUTPUT } from "./support/fixtures.js";

test("amendPlan rejects amendments that move an operation to a denied path", () => {
  const plans = new Map<string, StoredPlan>();
  const context = { snapshot: representativeSnapshot, catalogue: BASE_CATALOGUE, panelSessionId: "panel-test", plans, ...VERIFIED_HOST };
  const proposed = callTool("ae_propose_plan", {
    summary: "Render to home",
    operations: [{ type: "render_composition", compositionId: "comp-main", outputPath: RENDER_OUTPUT, destinationPolicy: "explicit-local-path" }],
  }, context);
  assert.equal(proposed.ok, true, `proposal should succeed: ${JSON.stringify(proposed)}`);
  const planId = stringAt(resultData(proposed), "planId");
  assert.ok(planId);
  const amended = callTool("ae_amend_plan", {
    planId,
    edits: [{ op: "replace", index: 0, operation: { type: "render_composition", compositionId: "comp-main", outputPath: "/etc/output.mp4", destinationPolicy: "explicit-local-path" } }],
  }, context);

  const refusal = refusalOf(amended);
  assert.equal(refusal.code, "INVALID_ARGUMENT", `expected INVALID_ARGUMENT but got ${refusal.code}`);
  assert.ok(refusal.message.includes("/etc"), "error should mention the denied path");
});

test("approvePlan re-checks path policy on approval", () => {
  const plans = new Map<string, StoredPlan>();
  const context = { snapshot: representativeSnapshot, catalogue: BASE_CATALOGUE, panelSessionId: "panel-test", plans, ...VERIFIED_HOST };
  const proposed = callTool("ae_propose_plan", {
    summary: "Render to home",
    operations: [{ type: "render_composition", compositionId: "comp-main", outputPath: RENDER_OUTPUT, destinationPolicy: "explicit-local-path" }],
  }, context);
  assert.equal(proposed.ok, true);
  const planId = stringAt(resultData(proposed), "planId");
  assert.ok(planId);
  const record = plans.get(planId);
  assert.ok(record);

  const operation = record.plan.operations[0];
  assert.ok(operation);
  Object.assign(operation, { outputPath: "/etc/output.mp4" });

  const approved = callTool("ae_approve_plan", { planId }, context);

  const refusal = refusalOf(approved);
  assert.equal(refusal.code, "INVALID_ARGUMENT", `expected INVALID_ARGUMENT but got ${refusal.code}`);
});

test("the path policy judges where a path really lands and refuses network shares", () => {
  const home = mkdtempSync(join(homedir(), ".extynt-path-policy-"));
  try {
    symlinkSync("/etc", join(home, "etc-link"));
    const linked = pathPolicyProblem(join(home, "etc-link", "not-yet-written.mp4"), "destination", "output path");
    assert.equal(linked?.code, "INVALID_ARGUMENT", "a symlink under home that lands in /etc is refused");
    assert.equal(pathPolicyProblem(join(home, "renders", "new.mp4"), "destination", "output path"), undefined, "a not-yet-created path under home stays allowed");
    assert.equal(pathPolicyProblem("//server/share/clip.mov", "source", "source path")?.code, "INVALID_ARGUMENT", "a UNC share is refused");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

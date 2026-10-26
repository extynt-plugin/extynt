// A confirmed project-item deletion compiles to exactly the host wire shape.
import test from "node:test";
import assert from "node:assert/strict";
import { representativeSnapshot } from "@extynt/project-graph";
import { computePlanDigest } from "@extynt/action-plan";
import { compileV2Plan } from "../src/index.js";

test("compiles an explicitly confirmed project-item deletion without broadening the host wire shape", () => {
  const snapshot = representativeSnapshot;
  const plan = { schemaVersion: "0.2" as const, planId: "delete-item-1", snapshotFingerprint: snapshot.fingerprint, selectionFingerprint: snapshot.selectionFingerprint, freshness: snapshot.freshness, summary: "Delete item", requiresApproval: true as const, bounds: { maxOperations: 1 }, preconditions: [], conflicts: [], postconditions: [], operations: [{ type: "delete_project_item" as const, target: { itemId: "comp-main", snapshotFingerprint: snapshot.fingerprint, selectionFingerprint: snapshot.selectionFingerprint }, destructive: true as const }], digest: "" };
  plan.digest = computePlanDigest(plan);
  const result = compileV2Plan(plan);
  assert.deepEqual(result, { operation: "apply_plan", planId: "delete-item-1", undoGroup: "extynt — delete-item-1", operations: [{ operation: "delete_project_item", itemId: "comp-main", destructive: true }] });
});


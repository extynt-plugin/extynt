// Proves ae_status names the newest applied work and why its read-back failed or was refused, collapses an unchanged repeat read, and never lets a stale refusal leak into a passed receipt.
import test from "node:test";
import assert from "node:assert/strict";
import { representativeSnapshot } from "@extynt/project-graph";
import { callTool } from "../src/index.js";
import type { StoredPlan, ToolContext } from "../src/index.js";
import { booleanAt, objectAt, stringAt } from "../src/json.js";
import type { JsonObject } from "@extynt/decode";
import { dataOf } from "./support/fixtures.js";
import { payloadOf } from "./support/json-results.js";
import { successOf } from "./support/protocol-views.js";

interface Scene {
  readonly context: ToolContext & { plans: Map<string, StoredPlan> };
  readonly record: StoredPlan;
  readonly planId: string;
}

const RING: JsonObject[] = [{ type: "create_layer", target: { compositionId: "comp-main", layerId: "__new__:ring" }, layerType: "shape", name: "Ring" }];

function proposeRing(context: Scene["context"], summary: string): { planId: string; record: StoredPlan } {
  const planId = dataOf(successOf(callTool("ae_propose_plan", { summary, operations: RING }, context))).planId;
  const record = context.plans.get(planId);
  assert.ok(record, "the proposed plan is stored");
  return { planId, record };
}

function sceneOf(summary: string): Scene {
  const context = { snapshot: representativeSnapshot, plans: new Map<string, StoredPlan>() };
  return { context, ...proposeRing(context, summary) };
}

function latestWork(context: ToolContext): JsonObject {
  const work = objectAt(payloadOf(callTool("ae_status", {}, context)), "latestWork");
  assert.ok(work, "the status reports the newest work");
  return work;
}

function assertFailedReadback(scene: Scene): void {
  scene.record.status = "failed";
  scene.record.updatedAt = "2026-01-01T00:00:01.000Z";
  scene.record.receipt = { planId: scene.planId, status: "executed", postcondition: "failed", mayHaveMutated: true, receivedAt: "2026-01-01T00:00:01.000Z", undoGroups: 6, repair: { failedCount: 12, operations: [
    { index: 3, operation: "set_text_document", basis: "text-document-mismatch", field: "font" },
    { index: 4, operation: "set_text_document", basis: "text-document-mismatch", field: "font" },
  ] } };
  const work = latestWork(scene.context);
  assert.equal(work.status, "failed");
  assert.equal(work.summary, "Countdown leader");
  assert.equal(work.operations, 1);
  assert.equal(work.applied, true, "the host ran it");
  assert.equal(work.verified, false, "and the read-back did not confirm it");
  assert.equal(work.undoGroups, 6);
  assert.equal(work.mayHaveMutated, true);
  assert.equal(work.failedOperations, 12, "the packet's own count outranks the rows it carried");
  assert.match(stringAt(work, "failureBasis") ?? "", /text-document-mismatch/);
  assert.match(stringAt(work, "failureBasis") ?? "", /font/, "and it names the field, which is what makes it repairable");
  assert.match(stringAt(work, "failureBasis") ?? "", /×2|2/, "grouped rather than listed once per operation");
  assert.equal(stringAt(objectAt(work, "retry"), "kind"), "repair_verification");
}

function assertRejectedReceipt(scene: Scene): void {
  scene.record.receipt = { planId: scene.planId, status: "rejected", postcondition: "not_run", mayHaveMutated: false, receivedAt: "2026-01-01T00:00:01.500Z", hostError: { code: "BAD_PROPERTY_PATH", message: "The target property path does not exist." }, failure: { phase: "apply", operationIndex: 0, operation: "create_layer" } };
  const work = latestWork(scene.context);
  assert.equal(work.error, "BAD_PROPERTY_PATH");
  assert.equal(work.errorMessage, "The target property path does not exist.");
  assert.deepEqual(work.failedOperation, { index: 0, type: "create_layer", phase: "apply" });
  assert.equal(stringAt(objectAt(work, "retry"), "kind"), "repair_failed_operation");
}

function assertLegacyRefusal(scene: Scene): void {
  scene.record.receipt = { planId: scene.planId, status: "rejected", postcondition: "not_run", mayHaveMutated: false, receivedAt: "2026-01-01T00:00:01.600Z", error: { code: "LEGACY_REFUSAL", message: "x".repeat(400) }, failure: { phase: { invalid: true }, operationIndex: 1, operation: "set_layer_name" } };
  const work = latestWork(scene.context);
  assert.equal((stringAt(work, "errorMessage") ?? "").length, 320);
  assert.deepEqual(work.failedOperation, { index: 1, type: "set_layer_name", phase: "unknown" });
}

function assertLegacyVerification(scene: Scene): void {
  scene.record.receipt = { planId: scene.planId, status: "executed", postcondition: "failed", receivedAt: "2026-01-01T00:00:01.000Z", verification: { steps: [{ operation: "set_layer_property", observed: false, verificationState: "failed", basis: "property-value-mismatch" }] } };
  const work = latestWork(scene.context);
  assert.equal(work.verified, false);
  assert.equal(work.failedOperations, 1);
  assert.match(stringAt(work, "failureBasis") ?? "", /property-value-mismatch/);
}

function assertPassedReceiptLeaksNothing(scene: Scene): void {
  scene.record.status = "verified";
  scene.record.receipt = { planId: scene.planId, status: "executed", postcondition: "passed", receivedAt: "2026-01-01T00:00:02.000Z", hostError: { code: "STALE_ERROR", message: "stale" }, failure: { phase: "apply", operationIndex: 0, operation: "create_layer" } };
  const work = latestWork(scene.context);
  assert.equal(work.verified, true);
  for (const absent of ["failedOperations", "failureBasis", "errorMessage", "failedOperation"]) assert.equal(work[absent], undefined);
  assert.equal(work.error, undefined, "executed receipts cannot leak stale refusal evidence");
}

test("ae_status reports the newest work and why its read-back failed, which is what the briefing promises", () => {
  const scene = sceneOf("Countdown leader");
  assert.equal(payloadOf(callTool("ae_status", {}, scene.context)).latestWork, null, "no work yet is said as nothing, not as a failure");
  assertFailedReadback(scene);
  assertRejectedReceipt(scene);
  assertLegacyRefusal(scene);
  assertLegacyVerification(scene);
  assertPassedReceiptLeaksNothing(scene);
});

test("a repeated status read inside one turn collapses, and a changed one never does", () => {
  const context = { snapshot: representativeSnapshot, plans: new Map<string, StoredPlan>() };
  const memory: { value: string | null } = { value: null };
  const status = (ctx: ToolContext): JsonObject => payloadOf(callTool("ae_status", {}, ctx));

  const first = status({ ...context, statusMemory: memory });
  assert.equal(first.unchanged, undefined, "the first read of a turn is whole");
  assert.ok(memory.value, "and it is remembered for the next one");

  const collapsed = status({ ...context, statusMemory: memory });
  assert.equal(collapsed.unchanged, true, "the second read says so instead of repeating itself");
  assert.equal(collapsed.latestWork, null, "and still carries the live work");

  const { planId, record } = proposeRing(context, "Ring");
  record.status = "applied_unverified";
  record.updatedAt = "2026-01-01T00:00:03.000Z";
  record.receipt = { planId, status: "executed", postcondition: "applied_unverified", receivedAt: "2026-01-01T00:00:03.000Z", undoGroups: 1 };
  const changed = status({ ...context, statusMemory: memory });
  assert.equal(changed.unchanged, undefined, "a receipt arriving defeats the collapse");
  assert.equal(booleanAt(objectAt(changed, "latestWork"), "verified"), false);

  assert.equal(status(context).unchanged, undefined);
});

test("ae_status names the plan applied last, not the one touched last, whoever authored either", () => {
  const context = { snapshot: representativeSnapshot, plans: new Map<string, StoredPlan>() };
  const applied = (summary: string, at: string): StoredPlan => {
    const { planId, record } = proposeRing(context, summary);
    record.status = "verified";
    record.updatedAt = at;
    record.receipt = { planId, status: "executed", postcondition: "passed", receivedAt: at, undoGroups: 1 };
    return record;
  };
  const older = applied("Rename in chat", "2026-01-01T00:00:01.000Z");
  applied("Rename by agent", "2026-01-01T00:00:02.000Z");
  older.status = "undone";
  older.updatedAt = "2026-01-01T00:00:09.000Z";
  assert.equal(stringAt(latestWork(context), "summary"), "Rename by agent");
});

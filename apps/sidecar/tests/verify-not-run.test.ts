/** The receipt pieces around a verification: refusals before After Effects is touched, the apply receipt, host response and precheck failure text, undo outcomes. */
import assert from "node:assert/strict";
import test from "node:test";
import { maybeListOf } from "./http-json.js";
import type { ApplyContext, HostApplyResult, HostSnapshot, PreApplyFailure } from "../src/verify/host-types.js";
import { applyBeginDetail, parseApplyHostResponse } from "../src/verify/host-response.js";
import { notRunReceipt } from "../src/verify/not-run.js";
import { preApplyReadFailure } from "../src/verify/precheck-failure.js";
import { makeApplyReceipt } from "../src/verify/receipt-build.js";
import { UNDO_CHANGED_TEXT, undoOutcome } from "../src/verify/undo-outcome.js";
import { wholeRead } from "../src/verify/whole-read.js";

test("a refusal names the approval it answers and says nothing ran", () => {
  const receipt = notRunReceipt({ planId: "p1", approval: { token: "cap-1" } }, "STALE_SNAPSHOT", "The project changed.");
  assert.deepEqual(receipt, { planId: "p1", operation: "apply_plan", status: "rejected", postcondition: "not_run", appliedOperations: [], mayHaveMutated: false, mutationState: "not-applied", hostError: { code: "STALE_SNAPSHOT", message: "The project changed." }, approvalId: "cap-1" });
  const anonymous = notRunReceipt(null, "HOST_OFFLINE", "After Effects is not running.");
  assert.equal(anonymous.planId, undefined);
  assert.equal("approvalId" in anonymous, false);
});

test("only a read of every composition is whole", () => {
  assert.equal(wholeRead({}), true);
  assert.equal(wholeRead({ result: { readScope: { compositions: "all" } } }), true);
  assert.equal(wholeRead({ result: { readScope: { compositions: "listed", items: "skipped" } } }), false);
});

const context = (over: Partial<ApplyContext> = {}): ApplyContext => ({
  approvedData: { planId: "p1", plan: { snapshotFingerprint: "fp-1" }, approval: { token: "cap-1" } },
  command: { operation: "apply_plan", planId: "p1", batchSize: 4, operations: [] }, approval: { token: "cap-1" }, ...over,
});

test("an applied plan becomes a pending-refresh receipt with the ids the host assigned", () => {
  const parsed: HostApplyResult = { ok: true, undoGroups: 1, steps: [{ operation: "create_layer", requestedLayerId: "__new__:layer", layerId: "L9", compositionId: "C1" }, { operation: "animate_property", propertyPath: "ADBE Transform Group/ADBE Position", keyframeMode: "linear", removedKeys: 0, afterKeys: 2 }] };
  const receipt = makeApplyReceipt(context({ hostProbeMs: 12 }), parsed, 340);
  assert.deepEqual([receipt.status, receipt.postcondition, receipt.mutationState, receipt.mayHaveMutated], ["executed", "pending_refresh", "applied", true]);
  assert.deepEqual(receipt.appliedOperations, ["create_layer", "animate_property"]);
  assert.deepEqual(receipt.created, { "__new__:layer": "L9" });
  assert.deepEqual([receipt.approvalId, receipt.beforeFingerprint, receipt.hostApplyMs, receipt.hostProbeMs, receipt.batchSize], ["cap-1", "fp-1", 340, 12, 4]);
  assert.equal(receipt.keyframeSteps instanceof Array && receipt.keyframeSteps.length, 1);
});

test("a failed apply keeps what ran and says whether the project may have changed", () => {
  const parsed: HostApplyResult = { ok: false, mayHaveMutated: true, mutationState: "partial", phase: "apply", failedOperationIndex: 5, failedOperation: "set_layer_property", steps: [{ operation: "create_layer" }], error: { code: "HOST_MUTATION_FAILED", message: "no" } };
  const receipt = makeApplyReceipt(context(), parsed);
  assert.deepEqual([receipt.status, receipt.postcondition, receipt.mayHaveMutated, receipt.undoGroups], ["rejected", "partial_mutation_possible", true, 2]);
  assert.deepEqual(receipt.failure, { phase: "apply", operationIndex: 5, operation: "set_layer_property" });
  assert.deepEqual(receipt.completedOperations, ["create_layer"]);
  const preflight = makeApplyReceipt(context(), { ok: false, mayHaveMutated: false, phase: "preflight", error: { code: "BAD", message: "x" } });
  assert.deepEqual([preflight.postcondition, preflight.mayHaveMutated], ["not_run", false]);
});

test("the receipt's undo groups are the groups that hold a step, so Undo presses match the stack", () => {
  const steps = [{ operation: "set_layer_attribute" }];
  assert.equal(makeApplyReceipt(context(), { ok: true, undoGroups: 3, changedUndoGroups: 2, steps }).undoGroups, 2);
  assert.equal(makeApplyReceipt(context(), { ok: true, undoGroups: 1, changedUndoGroups: 0, steps }).undoGroups, 0);
  assert.equal(makeApplyReceipt(context(), { ok: true, undoGroups: 1, steps }).undoGroups, 1);
  const failed = makeApplyReceipt(context(), { ok: false, mayHaveMutated: true, phase: "apply", failedOperationIndex: 5, undoGroups: 2, changedUndoGroups: 1, steps, error: { code: "HOST_MUTATION_FAILED", message: "no" } });
  assert.equal(failed.undoGroups, 1);
});

test("a host answer that is not an apply outcome is an unknown mutation, never a success", () => {
  const unknown = { ok: false, mayHaveMutated: true, mutationState: "unknown" };
  for (const text of ["not json", "[]", '{"ok":true}', '{"ok":true,"steps":[]}', '{"ok":false}', null]) assert.deepEqual({ ...parseApplyHostResponse(text, false), error: undefined }, { ...unknown, error: undefined }, String(text));
  assert.equal(parseApplyHostResponse('{"ok":true,"steps":[{"operation":"a"}]}', false).ok, true);
  assert.equal(parseApplyHostResponse('{"ok":true,"method":"undo"}', true).ok, true);
  assert.equal(parseApplyHostResponse('{"ok":false,"mayHaveMutated":false,"error":{"code":"X"}}', false).ok, false);
  assert.equal(applyBeginDetail({ planId: "p1", operations: [1, 2, 3] }), "p1 3 operations");
});

function refusal(raw: string | null, parsed: HostSnapshot | null, attempt: number, compositionId: string | null): PreApplyFailure {
  const failure = preApplyReadFailure(raw, parsed, attempt, compositionId);
  assert.ok(failure);
  return failure;
}

test("a failed read before an apply is explained, never guessed", () => {
  assert.equal(preApplyReadFailure(null, { ok: true }, 1, null), null);
  const noProject = refusal(null, { ok: false, error: { code: "NO_PROJECT" } }, 1, null);
  assert.deepEqual([noProject.code, noProject.retryable], ["NO_PROJECT", false]);
  assert.match(noProject.message, /Nothing was run; the project is unchanged/);
  assert.match(refusal(null, { ok: false, error: { code: "NO_ACTIVE_COMPOSITION" } }, 1, "C7").message, /id C7,/);
  const budget = refusal(null, { ok: false, error: { code: "PAYLOAD_LIMIT", details: { bytes: 9, limit: 8 } } }, 1, null);
  assert.match(budget.message, /\(9 of 8 bytes\)/);
});

test("an unreadable or unknown read failure keeps what the host said, bounded and cleaned", () => {
  const retry = preApplyReadFailure("garbled {{", null, 2, null);
  assert.deepEqual([retry?.code, retry?.retryable], ["HOST_READ_FAILED", true]);
  assert.match(retry?.message ?? "", /attempt 2/);
  const other = preApplyReadFailure(null, { ok: false, error: { code: "ODD", message: "it broke <b>" } }, 1, null);
  assert.match(other?.message ?? "", /^ODD from After Effects before applying: it broke b\./);
});

test("an undo answer is read for what the host did, not for ok", () => {
  assert.deepEqual(undoOutcome({ data: { status: "undone" } }), { problem: null, text: "Undone.", status: "undone" });
  assert.equal(undoOutcome({ data: { status: "undo_requested" } }).status, "undo_requested");
  assert.match(undoOutcome({ data: { workflowRefused: true } }).problem ?? "", /refused before After Effects was asked/);
  assert.equal(undoOutcome({ data: { receipt: { status: "rejected", hostError: { message: "changed" } } } }).problem, "Not undone: changed");
  assert.match(undoOutcome({ data: { receipt: { status: "unknown" } } }).problem ?? "", /^Undo outcome is unknown: no reason was given/);
  assert.match(undoOutcome({ data: { status: "undo_unverified" } }).problem ?? "", /does not match its state before/);
  assert.match(UNDO_CHANGED_TEXT, /Edit > Undo/);
});

test("files the host wrote outside the project ride into the receipt, success or failure, bounded", () => {
  const written = Array.from({ length: 20 }, (_, index) => ({ path: `/renders/out-${index}.mov`, operation: "render_composition" }));
  const ok = makeApplyReceipt(context(), { ok: true, steps: [{ operation: "render_composition" }], externalOutputs: written });
  assert.equal(maybeListOf(ok, "externalOutputs")?.length, 16);
  assert.deepEqual(maybeListOf(ok, "externalOutputs")?.[0], { path: "/renders/out-0.mov", operation: "render_composition" });
  const failed = makeApplyReceipt(context(), { ok: false, mayHaveMutated: true, phase: "apply", failedOperationIndex: 1, steps: [], externalOutputs: written.slice(0, 1), error: { code: "RENDER_EXECUTION_FAILED", message: "x" } });
  assert.deepEqual(failed.externalOutputs, written.slice(0, 1));
  assert.equal(makeApplyReceipt(context(), { ok: true, steps: [] }).externalOutputs, undefined);
});

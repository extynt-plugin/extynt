// Proves the compact views agents receive: plans, amendments, status polls and receipts shrink to what the model needs, keep what a human must see, and never carry approval tokens.
import assert from "node:assert/strict";
import test from "node:test";
import { receiptView } from "../src/receipt-agent-view.js";
import { createAgentViewMemory, toMcpToolResult } from "../src/transport.js";
import { arrayAt, objectAt, objectsIn, stringAt } from "../src/json.js";
import type { JsonObject } from "@extynt/decode";
import { mcpText, mcpView, mcpViewData } from "./support/protocol-views.js";

const EXPIRES = "2026-09-14T00:02:00Z";
const POSITION = "ADBE Transform Group/ADBE Position";
const OPACITY = "ADBE Transform Group/ADBE Opacity";
const GENERIC_NOTICES = [{ code: "NOT_IDEMPOTENT", title: "Rerun makes copies.", detail: "Apply once." }, { code: "UNDO_ONLY", title: "Undo is the way back.", detail: "Nothing reverses it." }];
const SPECIFIC_NOTICE = { code: "DESTRUCTIVE", title: "This plan deletes something.", detail: "Only Undo restores it." };
const NOTICES = [...GENERIC_NOTICES, SPECIFIC_NOTICE];
const WARNINGS = NOTICES.map((notice) => `${notice.title} ${notice.detail}`);
const NOTICE_PRESENTATION: JsonObject = { values: [], notices: NOTICES, warnings: WARNINGS };

function executedReceipt(extra: JsonObject): JsonObject {
  return { status: "executed", postcondition: "passed", ...extra };
}

function unverifiedStep(operation: string, basis: string): JsonObject {
  return { operation, observed: false, verificationState: "applied_unverified", basis };
}

test("agent results are sent once as compact text; verbose restores the full body", () => {
  const plan: JsonObject = { schemaVersion: "0.2", planId: "p1", summary: "Fade", digest: "0123456789abcdef0123", conflicts: [], operations: [{ type: "animate_property", target: { compositionId: "c", layerId: "l1", propertyPath: OPACITY, snapshotFingerprint: "fp" }, role: "transform.opacity", keyframes: [{ time: 0, value: 0 }, { time: 1, value: 100 }] }] };
  const proposed: JsonObject = { ok: true, tool: "ae_propose_plan", snapshotFingerprint: "fp", data: { planId: "p1", status: "prepared", plan, presentation: { values: [{ target: "Title" }], warnings: [] }, approvalCapability: { token: "secret-approval", expiresAt: EXPIRES }, renamedPlaceholders: {} } };
  const compact = toMcpToolResult(proposed);
  assert.equal("structuredContent" in compact, false);
  const viewData = mcpViewData(compact);
  assert.deepEqual(viewData.ops, [`animate_property l1(Title) ${OPACITY} 2k 0→100 @0-1s`]);
  assert.equal(viewData.digest, "0123456789ab");
  assert.equal(viewData.expiresAt, EXPIRES);
  assert.equal(mcpText(compact).includes("secret-approval"), false, "approval tokens never reach the model");
  const fullData = mcpViewData(toMcpToolResult(proposed, { verbose: true }));
  assert.equal(arrayAt(objectAt(fullData, "plan"), "operations")?.length, 1);
});

test("compact propose and amend views drop echoes and generic notices; verbose keeps them", () => {
  const plan: JsonObject = { schemaVersion: "0.2", planId: "p2", summary: "Make", digest: "0123456789abcdef0123", conflicts: [], operations: [{ type: "create_layer", target: { compositionId: "c", layerId: "__new__:a" } }] };
  const proposed: JsonObject = { ok: true, tool: "ae_propose_plan", snapshotFingerprint: "fp", data: { planId: "p2", status: "prepared", plan, presentation: NOTICE_PRESENTATION, renamedPlaceholders: { "__new__:a": "__new__:layer0" }, submittedOperations: [{ type: "create_layer", marker: "echo-me" }], bindings: { "__new__:a": "__new__:layer0" } } };
  const compact = mcpViewData(toMcpToolResult(proposed));
  assert.equal("submittedOperations" in compact, false);
  assert.equal("bindings" in compact, false);
  assert.deepEqual(compact.renamedPlaceholders, { "__new__:a": "__new__:layer0" });
  assert.deepEqual(compact.warnings, [WARNINGS[2]]);
  const full = mcpViewData(toMcpToolResult(proposed, { verbose: true }));
  assert.ok("submittedOperations" in full && "bindings" in full);
  assert.deepEqual(objectAt(full, "presentation")?.warnings, WARNINGS);

  const amended: JsonObject = { ok: true, tool: "ae_amend_plan", snapshotFingerprint: "fp", data: { planId: "p2", status: "prepared", amended: true, operationCount: 1, editedIndexes: [0], presentation: NOTICE_PRESENTATION, approvalCapability: { token: "secret-approval", expiresAt: EXPIRES } } };
  const amendCompact = mcpViewData(toMcpToolResult(amended));
  assert.equal("presentation" in amendCompact, false);
  assert.equal("approvalCapability" in amendCompact, false);
  assert.deepEqual(amendCompact, { planId: "p2", status: "prepared", amended: true, operationCount: 1, editedIndexes: [0], expiresAt: EXPIRES, warnings: [WARNINGS[2]] });
  assert.ok("presentation" in mcpViewData(toMcpToolResult(amended, { verbose: true })));
});

test("receipts compact to counts plus non-exact steps, and unchanged status polls collapse", () => {
  const exact = (operation: string): JsonObject => ({ operation, observed: true, verificationState: "exact", basis: "x" });
  const receipt: JsonObject = { status: "executed", postcondition: "applied_unverified", mutationState: "applied", approvalId: "secret", appliedOperations: ["a", "b", "c"], mayHaveMutated: true, keyframeSteps: [{ propertyPath: OPACITY, keyframeMode: "merge", removedKeys: 0, afterKeys: 4 }], verification: { steps: [exact("a"), exact("b"), unverifiedStep("set_text_document", "text-document-no-observable-requested-fields")] } };
  const memory = createAgentViewMemory();
  const status: JsonObject = { ok: true, tool: "ae_get_plan_status", snapshotFingerprint: "fp", data: { planId: "p1", status: "applied_unverified", postcondition: "applied_unverified", receipt } };
  const firstView = mcpView(toMcpToolResult(status, { memory }));
  const firstReceipt = objectAt(objectAt(firstView, "data"), "receipt");
  assert.deepEqual(firstReceipt?.verificationCoverage, { applied: true, readback: false, visual: false, temporal: false });
  assert.deepEqual(firstReceipt?.verified, { exact: 2, applied_unverified: 1 });
  assert.deepEqual(firstReceipt?.issues, ["set_text_document applied_unverified text-document-no-observable-requested-fields"]);
  assert.deepEqual(firstReceipt?.keys, [`${OPACITY} merge→4`]);
  assert.equal(JSON.stringify(firstView).includes("secret"), false);
  assert.deepEqual(mcpViewData(toMcpToolResult(status, { memory })), { planId: "p1", status: "applied_unverified", unchanged: true });
});

test("receipt views never collapse write, read-back, visual, and temporal evidence", () => {
  const applied = receiptView({ status: "executed", postcondition: "applied_unverified", mutationState: "applied" });
  assert.deepEqual(applied.verificationCoverage, { applied: true, readback: false, visual: false, temporal: false });
  const structural = receiptView({ status: "executed", postcondition: "passed", mutationState: "applied" });
  assert.deepEqual(structural.verificationCoverage, { applied: true, readback: true, visual: false, temporal: false });
  const reviewed = receiptView({ status: "executed", postcondition: "passed", mutationState: "applied", postconditions: [
    { postconditionId: "frame", kind: "visual", state: "passed", basis: "reviewed rendered frame" },
    { postconditionId: "motion", kind: "temporal", state: "passed", basis: "sampled critical times" },
  ] });
  assert.deepEqual(reviewed.verificationCoverage, { applied: true, readback: true, visual: true, temporal: true });
});

test("pending plan views keep the live pipeline visible even when the status poll collapses", () => {
  const memory = createAgentViewMemory();
  const status = (busySeconds: number): JsonObject => ({ ok: true, tool: "ae_get_plan_status", snapshotFingerprint: "fp", warning: "VERSION_SKEW: restart", data: { planId: "p1", status: "applying", postcondition: null, receipt: null, queuePosition: 2, pipeline: { panel: "busy", queued: 2, busySeconds } } });
  const first = mcpView(toMcpToolResult(status(3), { memory }));
  assert.equal(first.warning, "VERSION_SKEW: restart");
  assert.equal(objectAt(first, "data")?.queuePosition, 2);
  const secondData = mcpViewData(toMcpToolResult(status(9), { memory }));
  assert.equal(secondData.unchanged, true);
  assert.equal(objectAt(secondData, "pipeline")?.busySeconds, 9);
});

test("verbose bodies never carry approval tokens", () => {
  const result: JsonObject = { ok: true, tool: "ae_approve_plan", snapshotFingerprint: "fp", data: { planId: "p1", approval: { token: "secret-approval-token", expiresAt: "x" }, receipt: { approvalId: "secret-approval-token" } } };
  const text = mcpText(toMcpToolResult(result, { verbose: true }));
  assert.equal(text.includes("secret-approval-token"), false);
  assert.match(text, /\[redacted\]/);
});

function presented(data: JsonObject): JsonObject {
  return mcpViewData(toMcpToolResult({ ok: true, tool: "ae_present_plan", snapshotFingerprint: "fp", data }));
}

test("plan views carry the bounded expression sources an agent must relay to the human approving", () => {
  const presentation: JsonObject = { title: "Roll the credits", values: [{ label: "Operation 1", before: "set_expression", after: "TITLE → expression: linear(time, 0, 2, 1180, -100)" }], warnings: [], expressions: [{ propertyPath: POSITION, source: "y".repeat(4096) }, { propertyPath: OPACITY, source: "value" }] };
  const view = presented({ planId: "p1", status: "presented", presentation });
  assert.deepEqual(view.ops, ["Operation 1: set_expression → TITLE → expression: linear(time, 0, 2, 1180, -100)"]);
  const expressions = objectsIn(arrayAt(view, "expressions"));
  assert.equal(expressions.length, 2);
  assert.equal(expressions[0]?.propertyPath, POSITION);
  assert.equal(stringAt(expressions[0], "source")?.length, 400, "a 4096-character script never rides through the agent view whole");
  assert.equal(stringAt(expressions[0], "source")?.endsWith("…"), true, "the excerpt is marked");
  assert.equal(expressions[1]?.source, "value");
  assert.equal("expressions" in presented({ planId: "p2", status: "prepared", presentation: { title: "Fade", values: [] } }), false);
  const operation = { type: "set_expression", target: { compositionId: "c", layerId: "l1", propertyPath: POSITION, snapshotFingerprint: "fp" }, source: "value + [10, 0]", enabled: true };
  const plan: JsonObject = { planId: "p3", summary: "Roll the credits", digest: "0123456789abcdef0123", conflicts: [], operations: [operation] };
  const proposed = mcpViewData(toMcpToolResult({ ok: true, tool: "ae_propose_plan", snapshotFingerprint: "fp", data: { planId: "p3", status: "prepared", plan, presentation } }));
  const proposedExpressions = objectsIn(arrayAt(proposed, "expressions"));
  assert.equal(proposedExpressions.length, 2);
  assert.equal(stringAt(proposedExpressions[0], "source")?.endsWith("…"), true);
});

test("present plan views keep the operation label beside each before/after value", () => {
  const output = presented({ planId: "p1", status: "presented", presentation: { title: "Fade", values: [{ label: "Blur amount", before: 12, after: 24 }, { label: "Position", before: [960, 540], after: [1000, 540] }] } });
  assert.deepEqual(output.ops, ["Blur amount: 12 → 24", "Position: 960,540 → 1000,540"]);
  const unlabelled = presented({ planId: "p2", status: "prepared", presentation: { title: "Fade", values: [{ before: 0, after: 100 }] } });
  assert.deepEqual(unlabelled.ops, ["0 → 100"]);
});

test("a success band is never reported to the agent as an issue", () => {
  const receipt: JsonObject = {
    status: "executed", postcondition: "applied_unverified", mutationState: "applied",
    outcomeCounts: { confirmed: 0, host_confirmed: 1, coerced_equivalent: 1, applied_unconfirmed: 1, readback_mismatch: 0 },
    operationOutcomes: [
      { index: 0, type: "export_mogrt", outcome: "host_confirmed", basis: "mogrt-export-host-evidence" },
      { index: 1, type: "set_layer_property", outcome: "coerced_equivalent", basis: "property-value-coerced" },
      { index: 2, type: "ensure_shape_fill", outcome: "applied_unconfirmed", basis: "host-step-evidence-state-not-in-snapshot" },
    ],
    verification: { steps: [
      unverifiedStep("export_mogrt", "mogrt-export-host-evidence"),
      unverifiedStep("set_layer_property", "property-value-coerced"),
      unverifiedStep("ensure_shape_fill", "host-step-evidence-state-not-in-snapshot"),
    ] },
  };
  const view = receiptView(receipt);
  const outcomes = objectAt(view, "outcomes");
  assert.deepEqual(view.verified, { applied_unverified: 3 }, "the raw panel states are still reported as they arrived");
  assert.deepEqual(view.issues, ["ensure_shape_fill applied_unverified host-step-evidence-state-not-in-snapshot"]);
  assert.deepEqual(view.unconfirmed, ["#2 ensure_shape_fill applied_unconfirmed (host-step-evidence-state-not-in-snapshot)"]);
  assert.equal(outcomes?.host_confirmed, 1, "the new bands reach the agent as counts, not as silent drops");
  assert.equal(outcomes?.coerced_equivalent, 1);
});

test("without per-operation rows the raw state is all the view can report", () => {
  const view = receiptView({ status: "executed", postcondition: "applied_unverified", verification: { steps: [unverifiedStep("export_mogrt", "mogrt-export-host-evidence")] } });
  assert.deepEqual(view.issues, ["export_mogrt applied_unverified mogrt-export-host-evidence"]);
});

test("the panel's repair packet reaches the agent as fields, bounded on this side too", () => {
  const operations = Array.from({ length: 12 }, (_, index): JsonObject => ({ index, operation: "set_text_document", basis: "text-document-mismatch", field: "font" }));
  const repair = objectAt(receiptView({ status: "executed", postcondition: "failed", repair: { failedCount: 12, operations } }), "repair");
  assert.equal(repair?.failedCount, 12);
  const repaired = objectsIn(arrayAt(repair, "operations"));
  assert.equal(repaired.length, 8, "the packet is capped again on the transport side");
  assert.equal(repaired[0]?.field, "font");
  assert.equal(receiptView({ status: "executed", postcondition: "passed" }).repair, undefined);
  assert.equal(receiptView({ status: "executed", postcondition: "failed", repair: { operations: [] } }).repair, undefined);
});

test("an unverified plan whose every step settled names the steps behind its verdict", () => {
  const view = receiptView({
    status: "executed", postcondition: "applied_unverified", mutationState: "applied",
    operationOutcomes: [{ index: 0, type: "set_layer_property", outcome: "coerced_equivalent", basis: "property-value-coerced" }],
    verification: { steps: [unverifiedStep("set_layer_property", "property-value-coerced")] },
  });
  assert.equal(view.issues, undefined, "a success band is still not an issue");
  assert.deepEqual(view.unverifiedBecause, ["#0 set_layer_property applied_unverified property-value-coerced"]);
});

test("a receipt's off-frame layers reach the model as sentences, and layers that landed fine add nothing", () => {
  const message = "SIGNAL is mostly outside the 1920×1080 frame at 5 s: to centre it, use Position ≈ (-293,50).";
  const view = receiptView(executedReceipt({ mutationState: "applied", frameChecks: [
    { compositionId: "c", layerId: "l1", layer: "SIGNAL", verdict: "CLIPPED", message },
    { compositionId: "c", layerId: "l2", layer: "Backdrop", verdict: "IN_FRAME" },
  ] }));
  assert.deepEqual(view.frame, [message]);
  assert.equal(receiptView(executedReceipt({ mutationState: "applied", frameChecks: [{ layer: "A", verdict: "IN_FRAME" }] })).frame, undefined);
});

test("a rolled-back host rejection reaches the MCP client as one precise correction", () => {
  const view = receiptView({
    status: "rejected", postcondition: "not_run", mutationState: "rolled-back", mayHaveMutated: false, rollback: "Rolled back",
    failure: { phase: "apply", operationIndex: 1, operation: "set_expression" },
    hostError: { code: "EXPRESSION_INVALID", message: "EXPRESSION_INVALID: Expression Disabled\nError: This property has no keyframes" },
    operationOutcomes: [
      { index: 0, type: "set_layer_parent", outcome: "rejected_before_apply", targets: { layerId: "layer-2" }, mutated: false },
      { index: 1, type: "set_expression", outcome: "rejected_before_apply", targets: { layerId: "layer-8", propertyPath: "ADBE Transform Group/ADBE Scale" }, mutated: false },
    ],
  });
  const correction = stringAt(view, "correction") ?? "";
  assert.match(correction, /operation 2 of 2 \(set_expression on layer layer-8, property ADBE Transform Group\/ADBE Scale\)/);
  assert.match(correction, /This property has no keyframes/);
  assert.match(correction, /nothing from this batch was applied/);
  assert.match(correction, /Resend the whole batch corrected/);
  assert.equal(receiptView({ status: "rejected", postcondition: "partial_mutation_possible", mutationState: "partial-applied", mayHaveMutated: true }).correction, undefined, "an unproven rollback carries no correction");
});

test("a read-back mismatch reaches the MCP client as one correction naming the operations and values", () => {
  const view = receiptView({
    status: "executed", postcondition: "failed", mutationState: "applied", mayHaveMutated: true,
    operationOutcomes: [
      { index: 0, type: "create_layer", outcome: "confirmed", mutated: true },
      { index: 1, type: "reorder_layer", outcome: "readback_mismatch", basis: "layer-order-mismatch", targets: { layerId: "16" }, readBack: { expectedValue: 1, observedValue: 4 }, mutated: "unknown" },
    ],
  });
  const correction = stringAt(view, "correction") ?? "";
  assert.match(correction, /1 of 2 operation did not read back/);
  assert.match(correction, /operation 2 \(reorder_layer on layer 16; layer-order-mismatch: expected 1, observed 4\)/);
  assert.match(correction, /rest of the batch stands/);
  assert.equal(receiptView(executedReceipt({ mutationState: "applied", operationOutcomes: [{ index: 0, type: "create_layer", outcome: "confirmed" }] })).correction, undefined);
});

test("a propose with apply shows the approval outcome and receipt on the proposal, and a refusal leaves the plan id to approve", () => {
  const plan: JsonObject = { planId: "p1", summary: "Move", digest: "d".repeat(64), operations: [{ type: "set_layer_name", target: { layerId: "1" }, name: "A" }] };
  const proposal = (status: string, apply: JsonObject): JsonObject => mcpViewData(toMcpToolResult({ ok: true, tool: "ae_propose_plan", snapshotFingerprint: "s", data: { planId: "p1", status, plan, apply } }));
  const applied = proposal("verified", { approved: true, planId: "p1", status: "verified", receipt: { status: "executed", postcondition: "passed" } });
  assert.equal(applied.planId, "p1");
  assert.equal(applied.status, "verified");
  const apply = objectAt(applied, "apply");
  assert.ok(apply);
  assert.equal(apply.approved, true);
  assert.equal("planId" in apply, false);
  assert.ok(objectAt(apply, "receipt"));
  const refusal = { approved: false, refusal: { code: "UNVERIFIED_OPERATIONS", message: "Not applied." } };
  const refused = proposal("prepared", refusal);
  assert.equal(refused.planId, "p1");
  assert.equal(refused.status, "prepared");
  assert.deepEqual(refused.apply, refusal);
});

test("a receipt view carries the controls of effects the apply added, bounded", () => {
  const controls = Array.from({ length: 60 }, (_, index): JsonObject => ({ path: `ADBE Effect Parade/ADBE Glo2/c${index}`, matchName: `c${index}`, name: `Control ${index}`, valueType: "number", value: index }));
  const listed = objectsIn(arrayAt(receiptView(executedReceipt({ effectControls: [{ effect: "ADBE Glo2", controls }] })), "effectControls"));
  assert.equal(listed[0]?.effect, "ADBE Glo2");
  assert.equal(arrayAt(listed[0], "controls")?.length, 40);
  assert.equal("effectControls" in receiptView(executedReceipt({})), false);
});

test("a receipt names the files a plan wrote outside the project, bounded", () => {
  const written = Array.from({ length: 20 }, (_, index): JsonObject => ({ path: `/renders/out-${index}.mov${"x".repeat(index === 0 ? 2000 : 0)}`, operation: "render_composition" }));
  const view = receiptView({ status: "executed", postcondition: "pending_refresh", mutationState: "applied", appliedOperations: ["render_composition"], externalOutputs: written });
  const files = objectsIn(arrayAt(view, "files"));
  assert.equal(files.length, 16);
  assert.equal(stringAt(files[0], "path")?.length, 1024);
  assert.equal(files[1]?.operation, "render_composition");
  assert.equal("files" in receiptView(executedReceipt({ externalOutputs: [] })), false);
});

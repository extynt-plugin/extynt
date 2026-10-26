/** Receipts and the host verification ledger: what a receipt stores, what it bounds, and what the ledger banks. */
import { fieldOf, maybeFlagOf, maybeListOf, maybeNumberOf, maybeRecordOf, maybeTextOf, numberOf, parseJson, readJson, recordOf, recordsOf, textOf, textsOf, type JsonObject } from "./http-json.js";
import { claimWork } from "./host-apply.js";
import { authorization, mutableSnapshot, queueHarness, receiptResponse, sidecarFor, token } from "./sidecar-fixture.js";
import { MCP_SERVER_VERSION } from "@extynt/mcp-server";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("receipt storage compacts host execution evidence and derives its post-apply fingerprint", async (t) => {
  const sidecar = sidecarFor({ port: 0, token, panelSessionId: "panel-receipt", now: () => new Date("2026-09-11T12:00:00.000Z") });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-receipt")) });
  const response = await receiptResponse(sidecar, { planId: "receipt-plan", status: "executed", postcondition: "applied_unverified", operation: "apply_plan", approvalId: "approval-1", beforeFingerprint: "before-fingerprint", afterFingerprint: "forged-host-revision", afterRevision: "host-revision-2", appliedOperations: Array.from({ length: 300 }, (_, index) => `operation-${index}`), host: { ignored: "untrusted transport data" } });
  assert.equal(response.status, 201);
  const stored = await readJson(response);
  assert.equal(textOf(stored, "receipt.approvalId"), "approval-1");
  assert.equal(textOf(stored, "receipt.beforeFingerprint"), "before-fingerprint");
  assert.notEqual(textOf(stored, "receipt.afterFingerprint"), "forged-host-revision");
  assert.ok(textOf(stored, "receipt.afterFingerprint"), "the sidecar derives the latest normalized snapshot fingerprint");
  assert.equal(textOf(stored, "receipt.afterRevision"), "host-revision-2");

  assert.equal(maybeListOf(stored, "receipt.appliedOperations")?.length, 256);
  assert.equal(maybeListOf(stored, "receipt.appliedOperations")?.[255], "operation-255");
  assert.equal("host" in recordOf(stored, "receipt"), false);
});

function assertFailureBanked(stateDirectory: string): void {
  const ledger = parseJson(readFileSync(join(stateDirectory, "runtime-operation-evidence.json"), "utf8"));
  const recorded = maybeRecordOf(Object.values(recordOf(ledger, "hosts"))[0], "set_layer_name");
  assert.equal(recorded?.lastFailedAt, "2026-09-11T12:00:00.000Z");
  assert.equal(recorded?.lastFailureBasis, "layer-name-mismatch");
  assert.equal(recorded?.failures, 1);
  assert.equal(recorded?.lastVerifiedAt, "2026-09-11T12:00:00.000Z");
}

const LONG_PLAN_STEPS: Readonly<Record<number, JsonObject>> = {
  100: { operation: "set_layer_name", verificationState: "failed", basis: "layer-name-mismatch" },
  64: { operation: "set_layer_name", verificationState: "applied_unverified", basis: "property-value-coerced" },
};

const longPlanStep = (index: number): JsonObject => LONG_PLAN_STEPS[index] ?? { operation: "set_layer_name", verificationState: "exact", basis: "layer-name" };

test("a long plan's read-back evidence and failure index survive into the stored receipt and the host ledger", async (t) => {
  const harness = await queueHarness(t, { ms: Date.parse("2026-09-11T12:00:00.000Z") });
  await harness.post("/v1/snapshots", mutableSnapshot("probe-long-receipt"));
  const operations = Array.from({ length: 129 }, (_, index) => ({ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name: `Layer ${index}` }));
  const proposed = await harness.agent("ae_propose_plan", { summary: "Rename a layer in 129 steps", operations });
  assert.equal(proposed.status, 200, JSON.stringify(proposed.body.error ?? proposed.body));
  const planId = String(fieldOf(proposed.body.data, "planId"));
  assert.equal((await harness.agent("ae_approve_plan", { planId })).status, 200);
  await claimWork(harness);

  const steps = operations.map((_, index) => longPlanStep(index));
  const response = await harness.post("/v1/receipts", {
    planId, status: "executed", postcondition: "applied_unverified", operation: "apply_plan",
    appliedOperations: operations.map((_, index) => `set_layer_name ${index}`),
    verification: { snapshotRequestId: "verify-long-receipt", targetFound: true, steps },
  });
  assert.equal(response.status, 201);
  const stored = await readJson(response);
  const receipt = recordOf(stored, "receipt");

  assert.equal(maybeListOf(receipt, "verification.steps")?.length, 129);
  assert.equal(maybeTextOf(receipt, "verification.steps.64.verificationState"), "applied_unverified");
  assert.equal(maybeTextOf(receipt, "verification.steps.64.basis"), "property-value-coerced");
  assert.equal(maybeTextOf(receipt, "verification.steps.100.verificationState"), "failed");
  assert.equal(maybeTextOf(receipt, "verification.steps.128.verificationState"), "exact");
  assert.equal(maybeListOf(receipt, "appliedOperations")?.[128], "set_layer_name 128");

  assert.equal(maybeListOf(receipt, "operationOutcomes")?.length, 129);
  assert.equal(maybeTextOf(receipt, "operationOutcomes.64.outcome"), "applied_unconfirmed");
  assert.equal(maybeTextOf(receipt, "operationOutcomes.64.basis"), "property-value-coerced");
  assert.equal(maybeTextOf(receipt, "operationOutcomes.100.outcome"), "readback_mismatch");
  assert.equal(maybeTextOf(receipt, "operationOutcomes.100.basis"), "layer-name-mismatch");
  assert.equal(maybeTextOf(receipt, "operationOutcomes.128.outcome"), "confirmed");
  assert.equal(maybeTextOf(receipt, "operationOutcomes.128.basis"), "layer-name");
  assert.equal(maybeListOf(receipt, "operationOutcomes")?.some((row) => maybeTextOf(row, "basis") === "no-read-back"), false);

  assertFailureBanked(harness.stateDirectory);
});

test("receipt bounds cap read-back evidence at what a plan can carry and keep a failure index past 63", async (t) => {
  const sidecar = sidecarFor({ port: 0, token, now: () => new Date("2026-09-11T12:00:00.000Z") });
  await sidecar.start();
  t.after(() => sidecar.stop());
  const post = async (body: JsonObject) => {
    const response = await receiptResponse(sidecar, body);
    assert.equal(response.status, 201);
    return recordOf(await readJson(response), "receipt");
  };

  const failure = await post({ planId: "long-failure-plan", status: "rejected", postcondition: "not_run", operation: "apply_plan", failure: { phase: "apply", operationIndex: 127, operation: "set_layer_property" } });
  assert.equal(maybeNumberOf(failure, "failure.operationIndex"), 127);

  assert.equal(maybeNumberOf(await post({ planId: "long-failure-plan", status: "rejected", postcondition: "not_run", operation: "apply_plan", failure: { phase: "apply", operationIndex: -1, operation: "set_layer_property" } }), "failure.operationIndex"), -1);

  assert.equal(fieldOf(await post({ planId: "long-failure-plan", status: "rejected", postcondition: "not_run", operation: "apply_plan", failure: { phase: "apply", operationIndex: 300, operation: "set_layer_property" } }), "failure.operationIndex"), null);

  const steps = Array.from({ length: 300 }, (_, index) => ({ operation: "set_layer_property", verificationState: "exact", basis: `basis-${index}` }));
  const stored = await post({ planId: "long-failure-plan", status: "executed", postcondition: "passed", operation: "apply_plan", verification: { steps } });
  assert.equal(maybeListOf(stored, "verification.steps")?.length, 256);
  assert.equal(maybeTextOf(stored, "verification.steps.255.basis"), "basis-255");

  const keyframeSteps = Array.from({ length: 300 }, (_, index) => ({ propertyPath: `ADBE Transform Group/ADBE Position ${index}`, keyframeMode: "linear", removedKeys: 0, afterKeys: index + 1 }));
  const withKeyframes = await post({ planId: "long-animation-plan", status: "executed", postcondition: "passed", operation: "apply_plan", keyframeSteps, verification: { steps: [] } });
  assert.equal(maybeListOf(withKeyframes, "keyframeSteps")?.length, 256);
  assert.equal(maybeTextOf(withKeyframes, "keyframeSteps.255.propertyPath"), "ADBE Transform Group/ADBE Position 255");
});

test("host hop timings survive into the stored receipt, the latest view, and ae_get_receipt", async (t) => {
  const harness = await queueHarness(t, { ms: Date.parse("2026-09-11T12:00:00.000Z") });
  const { base, agent } = harness;
  await harness.post("/v1/snapshots", mutableSnapshot("probe-host-hops"));
  const proposed = await agent("ae_propose_plan", { summary: "Rename a layer", operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name: "Layer 1" }] });
  assert.equal(proposed.status, 200, JSON.stringify(proposed.body));
  const planId = String(fieldOf(proposed.body.data, "planId"));
  assert.equal((await agent("ae_approve_plan", { planId })).status, 200);
  await claimWork(harness);
  const post = async (body: JsonObject) => {
    const response = await harness.post("/v1/receipts", body);
    assert.equal(response.status, 201);
    return recordOf(await readJson(response), "receipt");
  };

  const stored = await post({ planId, status: "executed", postcondition: "pending_refresh", operation: "apply_plan", hostProbeMs: 118, hostApplyMs: 412, verifyProbeMs: 260 });
  assert.equal(stored.hostProbeMs, 118);
  assert.equal(stored.hostApplyMs, 412);
  assert.equal(stored.verifyProbeMs, 260);

  const partial = await post({ planId: "host-hop-unmeasured", status: "rejected", postcondition: "not_run", operation: "apply_plan", hostApplyMs: 0 });
  assert.equal(partial.hostApplyMs, 0);
  assert.equal("hostProbeMs" in partial, false);
  assert.equal("verifyProbeMs" in partial, false);

  const nonsense = await post({ planId: "host-hop-nonsense", status: "executed", postcondition: "pending_refresh", operation: "apply_plan", hostProbeMs: -5, hostApplyMs: 1e12, verifyProbeMs: 12.9 });
  assert.equal(nonsense.hostProbeMs, undefined);
  assert.equal(nonsense.hostApplyMs, 600000);
  assert.equal(nonsense.verifyProbeMs, 12);

  const latest = await readJson(await fetch(`${base}/v1/receipts/latest`, { headers: authorization }));
  assert.equal(maybeTextOf(latest, "latest.planId"), "host-hop-nonsense");
  assert.equal(maybeNumberOf(latest, "latest.hostApplyMs"), 600000);
  const receipt = await agent("ae_get_receipt", { planId });
  assert.equal(receipt.status, 200);
  const fromTool = fieldOf(receipt.body.data, "receipt");
  assert.equal(maybeNumberOf(fromTool, "hostProbeMs"), 118);
  assert.equal(maybeNumberOf(fromTool, "hostApplyMs"), 412);
  assert.equal(maybeNumberOf(fromTool, "verifyProbeMs"), 260);
});

test("rejected host receipts retain a bounded, redacted host error for agent diagnosis", async (t) => {
  const harness = await queueHarness(t, { ms: Date.parse("2026-09-11T12:00:00.000Z") });
  await harness.post("/v1/snapshots", mutableSnapshot("probe-receipt"));
  const prepared = await harness.agent("ae_prepare_change");
  const planId = String(fieldOf(prepared.body.data, "planId"));

  await harness.agent("ae_approve_plan", { planId });
  await claimWork(harness);
  await harness.post("/v1/receipts", { planId, operation: "apply_plan", status: "rejected", postcondition: "partial_mutation_possible", appliedOperations: [], completedOperations: ["set_text_document"], mayHaveMutated: true, mutationState: "partial-applied", rollback: "After Effects Undo required", hostError: { code: "TEXT_ANIMATOR_UNSUPPORTED", message: "AE rejected /Users/test/private token=secret while adding text animator" } });
  const status = await harness.agent("ae_get_plan_status", { planId });
  const rejectedReceipt = fieldOf(status.body.data, "receipt");
  const error = fieldOf(rejectedReceipt, "hostError");
  assert.deepEqual(error, { code: "TEXT_ANIMATOR_UNSUPPORTED", message: "AE rejected [path] [redacted] while adding text animator" });
  assert.deepEqual(maybeListOf(rejectedReceipt, "appliedOperations"), []);
  assert.deepEqual(maybeListOf(rejectedReceipt, "completedOperations"), ["set_text_document"]);
  assert.equal(maybeFlagOf(rejectedReceipt, "mayHaveMutated"), true);
  assert.equal(maybeTextOf(rejectedReceipt, "mutationState"), "partial-applied");
  assert.equal(maybeTextOf(rejectedReceipt, "rollback"), "After Effects Undo required");
});

test("exact live verification is recorded per host and reported by the native operation registry", async (t) => {
  const harness = await queueHarness(t);
  const { post, agent, stateDirectory } = harness;
  await post("/v1/snapshots", mutableSnapshot("evidence-1"));
  assert.equal((await agent("ae_list_native_operations")).body.data.runtimeVerified, 0);

  const prepared = await agent("ae_prepare_change", { verbose: true });
  const planId = String(prepared.body.data.planId);
  const operations = recordsOf(fieldOf(prepared.body.data, "plan"), "operations");
  assert.deepEqual(operations.map((operation) => textOf(operation, "type")), ["ensure_effect", "animate_control", "animate_property"]);
  const stepFor = (operation: JsonObject) => {
    const type = textOf(operation, "type");
    const effectPath = fieldOf(operation, "target.effectPath");
    const propertyPath = fieldOf(operation, "target.propertyPath");
    return {
      operation: type, observed: type !== "animate_control",
      verificationState: type === "animate_control" ? "applied_unverified" : "exact", basis: `${type}-basis`,
      compositionId: textOf(operation, "target.compositionId"), layerId: textOf(operation, "target.layerId"),
      ...(type === "ensure_effect" && typeof effectPath === "string" ? { propertyPath: effectPath } : {}),
      ...(typeof propertyPath === "string" ? { propertyPath } : {}),
    };
  };

  const steps = [0, 2, 1].map((index) => stepFor(operations[index] ?? {}));
  await agent("ae_approve_plan", { planId });
  await claimWork(harness);
  const posted = await readJson((await post("/v1/receipts", { planId, operation: "apply_plan", status: "executed", postcondition: "passed", appliedOperations: ["ensure_effect", "animate_property"], mayHaveMutated: true, mutationState: "applied", verification: { steps } })));
  const outcomes = Object.fromEntries((maybeListOf(posted, "receipt.operationOutcomes") ?? []).map((row): [string, string] => [textOf(row, "type"), `${textOf(row, "outcome")} (${textOf(row, "basis")})`]));
  assert.deepEqual(outcomes, {
    ensure_effect: "confirmed (ensure_effect-basis)",
    animate_control: "applied_unconfirmed (animate_control-basis)",
    animate_property: "confirmed (animate_property-basis)",
  });

  const listed = (await agent("ae_list_native_operations")).body.data;
  assert.ok(numberOf(listed, "runtimeVerified") >= 2);
  assert.deepEqual(textsOf(listed, "runtimeVerifiedPlanTypes"), ["animate_property", "ensure_effect"]);
  const restarted = sidecarFor({ port: 0, token, stateDirectory });
  const address = await restarted.start(); t.after(() => restarted.stop());
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("evidence-2")) });
  const persisted = await readJson((await fetch(`http://${address.host}:${address.port}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ name: "ae_list_native_operations", arguments: {} }) })));
  assert.ok(numberOf(persisted, "data.runtimeVerified") >= 2, "evidence survives a sidecar restart");
});

test("the ledger banks a host-confirmed write that the panel could not compare", async (t) => {
  const harness = await queueHarness(t);
  const { base, post, agent, stateDirectory } = harness;
  await post("/v1/snapshots", mutableSnapshot("ledger-host-1"));
  assert.equal(textsOf((await agent("ae_list_native_operations")).body.data, "runtimeVerifiedPlanTypes").includes("set_project_settings"), false, "nothing has been proven on this host yet");

  const approve = async (planId: string) => {
    const response = await fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", "X-AE-Client": "agent", "X-AE-Client-Version": MCP_SERVER_VERSION }, body: JSON.stringify({ name: "ae_approve_plan", arguments: { planId, waitSeconds: 0 } }) });
    return { status: response.status, body: recordOf(await readJson(response), "") };
  };
  const propose = async (linearBlending: boolean) => String((await agent("ae_propose_plan", { summary: "Turn on linear blending", operations: [{ type: "set_project_settings", settings: { linearBlending } }] })).body.data.planId);
  const planId = await propose(true);
  assert.equal((await agent("ae_approve_plan", { planId })).status, 200);
  await claimWork(harness);
  const posted = await readJson((await post("/v1/receipts", { planId, operation: "apply_plan", status: "executed", postcondition: "applied_unverified", appliedOperations: ["set_project_settings"], mayHaveMutated: true, mutationState: "applied", verification: { steps: [{ operation: "set_project_settings", observed: false, verificationState: "applied_unverified", basis: "project-settings-host-read-back", hostVerification: "project-settings-read-back" }] } })));

  assert.equal(maybeTextOf(posted, "receipt.operationOutcomes.0.outcome"), "host_confirmed");
  const ledger = parseJson(readFileSync(join(stateDirectory, "runtime-operation-evidence.json"), "utf8"));
  const recorded = maybeRecordOf(Object.values(recordOf(ledger, "hosts"))[0], "set_project_settings");
  assert.equal(recorded?.count, 1, "the derived band reached the persisted ledger");
  assert.equal(recorded?.lastVerifiedAt, "2026-09-14T12:00:00.000Z");

  assert.equal(textsOf((await agent("ae_list_native_operations")).body.data, "runtimeVerifiedPlanTypes").includes("set_project_settings"), true);

  assert.equal((await approve(await propose(false))).status, 200, "approval stays open after this host has proven the work");
});

test("the ledger banks a coerced-equivalent write, ignores an unconfirmed one, and still regresses on a mismatch", async (t) => {
  const harness = await queueHarness(t);
  const { post, agent, stateDirectory } = harness;
  await post("/v1/snapshots", mutableSnapshot("ledger-band-1"));
  const positionPath = "ADBE Transform Group/ADBE Position";
  const propose = async (value: number[]) => String((await agent("ae_propose_plan", { summary: "Move the layer", operations: [{ type: "set_layer_property", target: { compositionId: "comp-1", layerId: "layer-1" }, role: "transform.position", propertyPath: positionPath, value }] })).body.data.planId);
  const apply = async (value: number[], step: JsonObject) => {
    const planId = await propose(value);
    assert.equal((await agent("ae_approve_plan", { planId })).status, 200);
    await claimWork(harness);
    return recordOf(await readJson((await post("/v1/receipts", { planId, operation: "apply_plan", status: "executed", postcondition: "applied_unverified", appliedOperations: ["set_layer_property"], mayHaveMutated: true, mutationState: "applied", verification: { steps: [step] } }))), "");
  };
  const ledgerRow = () => {
    const ledger = parseJson(readFileSync(join(stateDirectory, "runtime-operation-evidence.json"), "utf8"));
    return maybeRecordOf(Object.values(recordOf(ledger, "hosts"))[0], "set_layer_property");
  };
  const step = (outcome: JsonObject) => ({ operation: "set_layer_property", observed: false, compositionId: "comp-1", layerId: "layer-1", propertyPath: positionPath, ...outcome });

  const coerced = await apply([961, 541], step({ verificationState: "applied_unverified", basis: "property-value-coerced" }));
  assert.equal(maybeTextOf(coerced.receipt, "operationOutcomes.0.outcome"), "coerced_equivalent");
  assert.equal(ledgerRow()?.count, 1);
  assert.equal(textsOf((await agent("ae_list_native_operations")).body.data, "runtimeVerifiedPlanTypes").includes("set_layer_property"), true);

  const unconfirmed = await apply([963, 543], step({ verificationState: "applied_unverified", basis: "host-step-evidence-state-not-in-snapshot" }));
  assert.equal(maybeTextOf(unconfirmed.receipt, "operationOutcomes.0.outcome"), "applied_unconfirmed");
  assert.equal(ledgerRow()?.count, 1, "an unconfirmed write banks nothing");
  assert.equal(ledgerRow()?.lastFailedAt, undefined);

  const failed = await apply([965, 545], step({ verificationState: "failed", basis: "property-value-mismatch" }));
  assert.equal(maybeTextOf(failed.receipt, "operationOutcomes.0.outcome"), "readback_mismatch");
  assert.equal(ledgerRow()?.failures, 1, "the mismatch regressed the plan type");
  assert.equal(ledgerRow()?.lastFailureBasis, "property-value-mismatch");
  const afterRegression = (await agent("ae_list_native_operations")).body.data;
  assert.equal(textsOf(afterRegression, "runtimeVerifiedPlanTypes").includes("set_layer_property"), false, "the newest word is the contradiction, not the earlier success");
});

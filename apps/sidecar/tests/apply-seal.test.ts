/** Applying through the panel: seal outcomes, wait allowances, live probes, and a claimed batch that is re-offered. */
import { fieldOf, flagOf, listOf, maybeFlagOf, maybeListOf, maybeNumberOf, maybeRecordOf, maybeTextOf, numberOf, parseJson, readJson, recordOf, textOf, type JsonObject } from "./http-json.js";
import { APPROVED_CLAIM_GRACE_MS } from "../src/server-limits.js";
import { remainingWaitSeconds } from "../src/server-durations.js";
import type { ReadOnlySidecar } from "../src/server.js";
import { withoutThumbnails } from "./host-without-thumbnails.js";
import { present } from "./present.js";
import { authorization, chatTurn, claimOver, claimResponse, matchingFocus, mutableSnapshot, pause, receiptResponse, sidecarFor, sidecarForPlugin, token, withVerificationAck, workflowStageStep } from "./sidecar-fixture.js";
import { MockProvider } from "@extynt/llm";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

const claimedItem = (sidecar: ReadOnlySidecar): JsonObject | undefined => {
  const { body } = claimOver(sidecar);
  return body.item ? recordOf(body, "item") : undefined;
};

const postPipeline = (base: string, detail: string) => fetch(`${base}/v1/pipeline`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ event: "apply-begin", detail }) });

const hostRuns = async (sidecar: ReadOnlySidecar, base: string, item: JsonObject, receipt?: (planId: string) => JsonObject): Promise<string> => {
  const planId = textOf(item, "planId");
  const body = receipt?.(planId);
  if (!body) return planId;
  await postPipeline(base, `${planId} 1 operations`);
  const landed = await receiptResponse(sidecar, { ...body, approvalId: textOf(item, "approval.token") });
  assert.ok(landed.ok, `the host's receipt was refused: ${landed.status} ${await landed.text()}`);
  return planId;
};

const panelTakesBatch = async (sidecar: ReadOnlySidecar, base: string, receipt?: (planId: string) => JsonObject, timeoutMs = 8_000): Promise<string | undefined> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const item = claimedItem(sidecar);
    if (item && maybeTextOf(item, "planId")) return await hostRuns(sidecar, base, item, receipt);
    const ready = await readJson((await fetch(`${base}/v1/chat/plans/ready`, { headers: authorization })));
    const planId = maybeTextOf(ready, "plans.0.planId");
    if (planId) {
      const approved = await readJson((await fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ name: "ae_approve_plan", arguments: withVerificationAck("ae_approve_plan", { planId }) }) })));
      if (maybeTextOf(approved, "data.status") !== "approved") return undefined;
      continue;
    }
    await pause(10);
  }
  return undefined;
};

const sealWaitFor = (stateDirectory: string, planId: string): JsonObject | undefined => readFileSync(join(stateDirectory, "pipeline.log"), "utf8")
  .split("\n").filter(Boolean).map((line) => recordOf(parseJson(line), ""))
  .filter((line) => fieldOf(line, "planId") === planId && ["plan.apply-observed", "plan.apply-timeout"].includes(String(fieldOf(line, "event")))).at(-1);

const stateDirectoryFor = (t: TestContext): string => {
  const directory = mkdtempSync(join(tmpdir(), "ae-seal-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
};

const sealOnce = (waitSeconds: number, name = "Hero") => new MockProvider({ script: (input) => {
  const called = input.messages.filter((message) => message.role === "tool").map((message) => message.name);
  if (input.messages.some((message) => message.role === "user" && message.content.includes("Continue this workflow"))) return { text: "The batch landed.", toolCalls: [] };
  if (!called.includes("ae_select_workflow_stage")) return workflowStageStep("seal");
  if (!called.includes("ae_queue_add")) return { text: "", toolCalls: [{ id: "a1", name: "ae_queue_add", arguments: { summary: "Rename", operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name }] } }] };
  if (!called.includes("ae_queue_finish")) return { text: "", toolCalls: [{ id: "a2", name: "ae_queue_finish", arguments: { waitSeconds } }] };
  return { text: "Renamed it.", toolCalls: [] };
} });

test("a seal's wait ends on its own batch's receipt instead of spending the whole allowance", async (t) => {
  const stateDirectory = stateDirectoryFor(t);
  const sidecar = withoutThumbnails(sidecarFor({ port: 0, token, stateDirectory, chatProvider: sealOnce(10), quietAgentLog: true }));
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  await fetch(`${base}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-seal-outcome")) });

  const applying = panelTakesBatch(sidecar, base, (planId) => ({ planId, operation: "apply_plan", status: "executed", postcondition: "applied_unverified", appliedOperations: ["set_layer_name"], mayHaveMutated: true, mutationState: "applied", undoGroups: 1 }));
  const startedAt = Date.now();
  const reply = await chatTurn(address, "rename this to Hero", [], { autoApply: true });
  const elapsed = Date.now() - startedAt;
  const planId = await applying;
  assert.ok(planId, "the panel was handed the sealed batch");
  assert.equal(reply.ok, true);
  const wait = sealWaitFor(stateDirectory, planId);
  assert.equal(maybeTextOf(wait, "event"), "plan.apply-observed", `the receipt ended the wait: ${JSON.stringify(wait)}`);
  assert.ok(Number(maybeNumberOf(wait, "waitedMs")) < 8_000, `the wait stopped at the receipt, not at the 10-second allowance (waited ${String(maybeNumberOf(wait, "waitedMs"))} ms)`);
  assert.notEqual(maybeTextOf(wait, "status"), "verified", "a read-back that did not confirm is recorded as exactly that, never as verified");
  assert.ok(elapsed < 10_000, `and the turn did not outlive it (took ${elapsed} ms)`);
});

test("a seal's wait records a passed read-back as verified, and only when the receipt says so", async (t) => {
  const stateDirectory = stateDirectoryFor(t);
  const sidecar = withoutThumbnails(sidecarFor({ port: 0, token, stateDirectory, chatProvider: sealOnce(10), quietAgentLog: true }));
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  await fetch(`${base}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-seal-verified")) });
  const applying = panelTakesBatch(sidecar, base, (planId) => ({ planId, operation: "apply_plan", status: "executed", postcondition: "passed", appliedOperations: ["set_layer_name"], mayHaveMutated: true, mutationState: "applied", undoGroups: 1 }));
  await chatTurn(address, "rename this to Hero", [], { autoApply: true });
  const planId = await applying;
  assert.ok(planId, "the panel was handed the sealed batch");
  const wait = sealWaitFor(stateDirectory, planId);
  assert.equal(maybeTextOf(wait, "event"), "plan.apply-observed");
  assert.equal(maybeTextOf(wait, "status"), "verified", "the only receipt that may be recorded as verified is one whose read-back passed");
});

test("a seal that outlasts the panel spends the wait it was given, and never fails the seal", async (t) => {
  const stateDirectory = stateDirectoryFor(t);
  const sidecar = withoutThumbnails(sidecarFor({ port: 0, token, stateDirectory, chatProvider: sealOnce(1), quietAgentLog: true }));
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  await fetch(`${base}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-seal-timeout")) });

  const taking = panelTakesBatch(sidecar, base);
  const startedAt = Date.now();
  const reply = await chatTurn(address, "rename this to Hero", [], { autoApply: true });
  const elapsed = Date.now() - startedAt;
  const planId = await taking;
  assert.ok(planId, "the panel was handed the sealed batch");
  assert.equal(reply.ok, true, "a seal that outlasts the panel is still a successful call");
  assert.equal(reply.outcome, "planned", "the seal stands: nothing about a timeout un-seals the plan");
  assert.ok(elapsed >= 900, `the seal must spend the wait it was given rather than returning before the panel could answer (took ${elapsed} ms)`);
  const wait = sealWaitFor(stateDirectory, planId);
  assert.equal(maybeTextOf(wait, "event"), "plan.apply-timeout");
  assert.equal(maybeFlagOf(wait, "panelGone"), false, "the panel that took the batch is not reported as absent");
  assert.ok(["prepared", "approved", "applying"].includes(String(maybeTextOf(wait, "status"))), `the plan's own status is reported, got ${String(maybeTextOf(wait, "status"))}`);
  assert.ok(Number(maybeNumberOf(wait, "waitedMs")) > 500 && Number(maybeNumberOf(wait, "waitedMs")) <= 1_100, `the wait is reported as what it was, got ${String(maybeNumberOf(wait, "waitedMs"))} ms`);
});

test("with no panel polling, a seal succeeds promptly instead of spending its allowance", async (t) => {
  const stateDirectory = stateDirectoryFor(t);
  const sidecar = sidecarForPlugin({ port: 0, token, stateDirectory, chatProvider: sealOnce(20), quietAgentLog: true });
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  await fetch(`${base}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-seal-no-panel")) });
  const startedAt = Date.now();
  const reply = await chatTurn(address, "rename this to Hero", [], { autoApply: true });
  const elapsed = Date.now() - startedAt;
  assert.equal(reply.ok, true);
  assert.equal(reply.outcome, "planned");
  assert.ok(elapsed < 5_000, `a panel that never polls must not turn a successful seal into a stall (took ${elapsed} ms of a 20-second allowance)`);
  const wait = sealWaitFor(stateDirectory, present(reply.plans[0]).planId);
  assert.equal(maybeTextOf(wait, "event"), "plan.apply-timeout");
  assert.equal(maybeFlagOf(wait, "panelGone"), true, "the wait ended because nobody was there, and says so");
  assert.ok(Number(maybeNumberOf(wait, "waitedMs")) <= 3_000, `the wait is the grace it spent, not the allowance, got ${String(maybeNumberOf(wait, "waitedMs"))} ms`);
});

test("a seal waits on its own plan's receipt, not whichever record moved last", async (t) => {
  const stateDirectory = stateDirectoryFor(t);
  const sidecar = withoutThumbnails(sidecarFor({ port: 0, token, stateDirectory, chatProvider: sealOnce(2, "Zero"), quietAgentLog: true }));
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  await fetch(`${base}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-seal-scope")) });
  const external = async (name: string, args: JsonObject) => recordOf(await readJson((await fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", "X-AE-Client": "agent" }, body: JSON.stringify({ name, arguments: withVerificationAck(name, args) }) }))), "");
  const offered = async () => listOf(await readJson((await fetch(`${base}/v1/chat/plans/ready`, { headers: authorization }))), "plans");

  const externalId = textOf(await external("ae_propose_plan", { summary: "External rename", operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name: "Hero" }] }), "data.planId");
  const approvalId = maybeTextOf(await external("ae_approve_plan", { planId: externalId, waitSeconds: 0 }), "data.approval.token");
  const latecomer = (async () => {
    while ((await offered()).length === 0) await pause(10);
    let claimed = claimedItem(sidecar);
    while (maybeTextOf(claimed, "planId") !== externalId) { await pause(10); claimed = claimedItem(sidecar); }
    return await receiptResponse(sidecar, { planId: externalId, approvalId, operation: "apply_plan", status: "executed", postcondition: "passed", appliedOperations: ["set_layer_name"], mayHaveMutated: true, mutationState: "applied", undoGroups: 9 });
  })();
  const reply = await chatTurn(address, "rename it to Zero", [], { autoApply: true });
  assert.equal((await latecomer).status, 201, "the external plan's receipt landed during the owner's wait");
  assert.equal(reply.ok, true);
  const ownId = present(reply.plans[0]).planId;
  assert.notEqual(ownId, externalId);
  const wait = sealWaitFor(stateDirectory, ownId);
  assert.equal(maybeTextOf(wait, "event"), "plan.apply-timeout", "another plan's receipt is not this plan's outcome, so the wait ran out");
  assert.equal(maybeFlagOf(wait, "panelGone"), false, "the panel was there and silent about this plan");
  assert.ok(Number(maybeNumberOf(wait, "waitedMs")) >= 1_500, `the other receipt did not end this wait early (waited ${String(maybeNumberOf(wait, "waitedMs"))} ms)`);
});

test("the two waits a seal may take share one allowance instead of stacking two defaults", () => {
  assert.equal(remainingWaitSeconds(45, 30_000), 15, "30 of 45 seconds spent leaves 15 for the plan this call seals");
  assert.equal(remainingWaitSeconds(45, 44_500), 0.5);
  assert.equal(remainingWaitSeconds(45, 45_000), 0, "a pre-wait that used its whole budget leaves none, not a fresh one");
  assert.equal(remainingWaitSeconds(45, 90_000), 0, "and one that overran leaves zero, never a negative wait");
  assert.equal(remainingWaitSeconds(0, 0), 0, "a caller that opted out of the wait is not handed one after the seal");
  assert.equal(remainingWaitSeconds(60, 0), 60, "an explicit ceiling is still the ceiling");
});

interface LatestWorkRig {
  propose: (summary: string) => Promise<string>;
  settle: (summary: string, body: JsonObject) => Promise<JsonObject>;
  work: () => Promise<JsonObject>;
}

const latestWorkRig = async (t: TestContext): Promise<LatestWorkRig> => {
  let clock = Date.parse("2026-09-18T15:00:00.000Z");
  const sidecar = withoutThumbnails(sidecarFor({ port: 0, token, panelSessionId: "panel-latest-work", quietAgentLog: true, approvalSweepMs: 60_000, now: () => new Date(clock += 1_000) }));
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  await fetch(`${base}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-latest-work")) });
  const approvals = new Map<string, string>();
  const call = async (name: string, args: JsonObject = {}) => { const result = recordOf(await readJson((await fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ name, arguments: withVerificationAck(name, args) }) }))), ""); if (name === "ae_approve_plan" && typeof args.planId === "string") approvals.set(args.planId, textOf(result, "data.approval.token")); return result; };
  const propose = async (summary: string) => String(fieldOf(await call("ae_propose_plan", { summary, operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name: summary }] }), "data.planId"));
  const receipt = async (planId: string, body: JsonObject) => {
    assert.equal(textOf(claimOver(sidecar).body, "item.planId"), planId, "the host claims the approved plan before it settles it");
    return await readJson(await receiptResponse(sidecar, { planId, approvalId: approvals.get(planId), operation: "apply_plan", status: "executed", appliedOperations: ["set_layer_name"], mayHaveMutated: true, mutationState: "applied", ...body }));
  };
  const settle = async (summary: string, body: JsonObject) => {
    const planId = await propose(summary);
    await call("ae_approve_plan", { planId });
    return recordOf(await receipt(planId, body), "");
  };
  return { propose, settle, work: async () => recordOf(await call("ae_status"), "data.latestWork") };
};

const REPAIR_PACKET: JsonObject = { failedCount: 12, operations: [
  ...Array.from({ length: 5 }, (_, index) => ({ index, operation: "set_layer_name", basis: "text-document-mismatch", field: "font" })),
  ...Array.from({ length: 2 }, (_, index) => ({ index: index + 5, operation: "set_layer_name", basis: "readback-mismatch" })),
  { index: 7, operation: "set_layer_name", basis: "font-mismatch" },
] };

const expectRepairPacket = async (rig: LatestWorkRig) => {
  await rig.settle("One rename", { postcondition: "failed", repair: REPAIR_PACKET });
  const failed = await rig.work();
  assert.equal(flagOf(failed, "verified"), false);
  assert.equal(numberOf(failed, "failedOperations"), 12, "the packet's own total, not the eight it itemised");
  assert.equal(textOf(failed, "failureBasis"), "text-document-mismatch (font) ×5; readback-mismatch ×2; font-mismatch; +4 more");
  assert.equal(textOf(failed, "retry.kind"), "repair_verification", "the next model cycle receives an explicit retry class rather than inferring one");
  assert.ok(textOf(failed, "failureBasis").length <= 160, "a 133-operation failure cannot bloat the answer");
};

const expectVerificationSteps = async (rig: LatestWorkRig) => {
  await rig.settle("Another rename", { postcondition: "failed", verification: { steps: [
    { operation: "set_text_document", verificationState: "exact", basis: "text-document-observed" },
    { operation: "set_text_document", verificationState: "failed", basis: "text-document-mismatch", option: "font" },
  ] } });
  const fallback = await rig.work();
  assert.equal(numberOf(fallback, "failedOperations"), 1);
  assert.equal(textOf(fallback, "failureBasis"), "text-document-mismatch (font)");
};

const expectPassing = async (rig: LatestWorkRig) => {
  await rig.settle("A third rename", { postcondition: "passed" });
  const passed = await rig.work();
  assert.equal(flagOf(passed, "verified"), true);
  assert.equal("failedOperations" in passed, false);
  assert.equal("failureBasis" in passed, false);
  assert.deepEqual(Object.keys(passed), ["status", "summary", "operations", "applied", "verified", "undoGroups", "undoneGroups", "mayHaveMutated"], "a passing receipt is the payload it always was");
};

const expectUnreadable = async (rig: LatestWorkRig) => {
  await rig.settle("A fourth rename", { postcondition: "failed", repair: { failedCount: "many", operations: "soon" }, verification: { steps: "later" } });
  const unreadable = await rig.work();
  assert.equal(flagOf(unreadable, "verified"), false);
  assert.equal("failedOperations" in unreadable, false);
};

test("ae_status names why the newest verification failed, without listing every operation", async (t) => {
  const rig = await latestWorkRig(t);
  await expectRepairPacket(rig);
  await expectVerificationSteps(rig);
  await expectPassing(rig);
  await expectUnreadable(rig);
});

const flatProbe = () => {
  const flat = mutableSnapshot("probe-flat");
  const composition = present(flat.result.compositions[0]);
  const layer = present(composition.layers[0]);
  const propertyPaths = [
    { path: "ADBE Effect Parade", matchName: "ADBE Effect Parade", displayName: "Effects", kind: "group", valueType: "unknown", value: null, canSetValue: false },
    { path: "ADBE Effect Parade/ADBE Gaussian Blur 2", matchName: "ADBE Gaussian Blur 2", displayName: "Gaussian Blur", kind: "group", valueType: "unknown", value: null, canSetValue: false },
    { path: "ADBE Effect Parade/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001", matchName: "ADBE Gaussian Blur 2-0001", displayName: "Blurriness", kind: "property", valueType: "number", value: 4, canSetValue: true },
  ];
  return { ...flat, result: { ...flat.result, compositions: [{ ...composition, layers: [{ ...layer, propertyPaths }] }] } };
};

test("a flat live probe becomes the property tree effect discovery walks", async (t) => {
  const sidecar = sidecarFor({ port: 0, token, panelSessionId: "panel-flat-probe", quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  const stored = await fetch(`${base}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(flatProbe()) });
  assert.equal(stored.status, 201);

  const search = await readJson((await fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", "X-AE-Client": "agent" }, body: JSON.stringify({ name: "ae_search_host_capabilities", arguments: { query: "Gaussian Blur", kinds: ["effect"], waitSeconds: 0 } }) })));
  assert.equal(flagOf(search, "ok"), true, JSON.stringify(search).slice(0, 300));
  const gaussian = (maybeListOf(search, "data.entries") ?? []).find((entry) => fieldOf(entry, "matchName") === "ADBE Gaussian Blur 2");
  assert.equal(maybeTextOf(gaussian, "availability"), "available", "the effect the probe reported flat is a capability this host actually has");
});

const step = (id: string, name: string, args: JsonObject) => ({ id, name, arguments: args });

const leaseProvider = () => new MockProvider({ script: (input) => {
  const marker = "WORKFLOW CONTINUATION INPUT (sidecar-owned structured evidence; do not infer beyond these fields):\n";
  const continuationText = input.system.split(marker)[1]?.split("\n\nTurn state")[0];
  if (continuationText) {
    const continuation = parseJson(continuationText.trim());
    const settled = recordOf(continuation, "settledBatches.0");
    return { text: "", toolCalls: [step("lease-complete", "ae_workflow_complete", { goalDigest: textOf(continuation, "goalDigest"), criterionIds: ["goal-observed"], evidence: [{ criterionId: "goal-observed", reference: { kind: "batch_receipt", batchId: textOf(settled, "batchId"), receiptId: textOf(settled, "receipt.receiptId") } }] })] };
  }
  const called = input.messages.filter((message) => message.role === "tool").map((message) => message.name);
  if (!called.includes("ae_select_workflow_stage")) return workflowStageStep("lease");
  if (!called.includes("ae_queue_add")) return { text: "", toolCalls: [step("a1", "ae_queue_add", { summary: "One batch", operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name: "Hero" }] })] };
  if (!called.includes("ae_queue_finish")) return { text: "", toolCalls: [step("a2", "ae_queue_finish", {})] };
  return { text: "Sealed it.", toolCalls: [] };
} });

interface LeaseCompletion { sidecar: ReturnType<typeof sidecarFor>; planId: string; ready: () => Promise<JsonObject> }

async function expectLeaseCompletion({ sidecar, planId, ready }: LeaseCompletion) {
  sidecar.wakeDeferredWorkflowContinuations();
  sidecar.drainWorkflowContinuations();
  for (let attempt = 0; attempt < 1000 && sidecar.workflowSchedulerRunning; attempt += 1) await pause(5);
  assert.equal(sidecar.workflowSchedulerRunning, false, "the receipt-driven provider cycle settled before the lease assertion");
  const workflowJobId = sidecar.workflowCoordinator.jobIdForPlan(planId);
  assert.ok(workflowJobId);
  assert.equal(sidecar.workflowCoordinator.workflowStore.getState().jobs[workflowJobId]?.status, "completed", "verified receipt evidence completes this single-batch fixture");
  assert.equal(sidecar.plans.size, 1, "the continuation must not author a second mutation batch");
  assert.equal(sidecar.plans.get(planId)?.status, "verified");
  assert.equal(listOf(await ready(), "plans").length, 0, "a receipted batch is never offered again");
}

test("a claimed batch the panel never commits is re-offered, and a receipted one is dropped", async (t) => {
  let clock = Date.parse("2026-09-18T15:00:00.000Z");
  let base = "";
  const provider = leaseProvider();
  const sidecar = withoutThumbnails(sidecarFor({ port: 0, token, panelSessionId: "panel-lease", chatProvider: provider, quietAgentLog: true, approvalSweepMs: 60_000, now: () => new Date(clock) }));
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  base = `http://${address.host}:${address.port}`;
  await fetch(`${base}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-lease")) });
  await fetch(`${base}/v1/chat`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ requestId: "chat-lease", message: "rename this" }) });
  const ready = async () => recordOf(await readJson((await fetch(`${base}/v1/chat/plans/ready`, { headers: authorization }))), "");
  const first = await ready();
  assert.equal(listOf(first, "plans").length, 1);
  const planId = textOf(first, "plans.0.planId");
  assert.equal(listOf(await ready(), "plans").length, 0, "inside the lease the handoff is still one-shot");

  clock += APPROVED_CLAIM_GRACE_MS + 1;
  const again = await ready();
  assert.equal(listOf(again, "plans").length, 1, "the batch the panel lost is offered again");
  assert.equal(textOf(again, "plans.0.planId"), planId);

  const panel = async (name: string, args: JsonObject) => recordOf(await readJson((await fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", "x-ae-client": "agent" }, body: JSON.stringify({ name, arguments: withVerificationAck(name, { ...args, waitSeconds: 0 }) }) }))), "");
  await fetch(`${base}/v1/panel/focus`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(matchingFocus()) });
  const approvalResult = await panel("ae_approve_plan", { planId });
  assert.equal(maybeTextOf(approvalResult, "data.status"), "approved", JSON.stringify(approvalResult));
  assert.equal(textOf(await readJson(claimResponse(sidecar)), "item.planId"), planId, "the host is handed the approved apply");
  clock += APPROVED_CLAIM_GRACE_MS + 1;
  assert.equal(listOf(await ready(), "plans").length, 0, "an approval inside its window is not re-offered");

  const begin = await fetch(`${base}/v1/pipeline`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ event: "apply-begin", detail: `${planId} 1 operations` }) });
  assert.equal(begin.status, 200, JSON.stringify(await begin.json()));
  const posted = await receiptResponse(sidecar, { planId, approvalId: textOf(approvalResult, "data.approval.token"), operation: "apply_plan", status: "executed", postcondition: "passed", appliedOperations: ["set_layer_name"], mayHaveMutated: true, mutationState: "applied", verification: { state: "exact", basis: "headless test readback", steps: [{ operation: "set_layer_name", verificationState: "exact", observed: true, basis: "headless test readback" }] } });
  const postedBody = recordOf(await posted.json(), "");
  assert.equal(posted.status, 201, JSON.stringify(postedBody));
  clock += APPROVED_CLAIM_GRACE_MS * 100;
  await expectLeaseCompletion({ sidecar, planId, ready });
});

test("a captured frame is answered in numbers, so a model that cannot see can still check it", async (t) => {
  const sidecar = sidecarFor({ port: 0, token, panelSessionId: "panel-observe", now: () => new Date("2026-09-11T12:00:00.000Z") });
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  const endpoint = `http://${address.host}:${address.port}`;
  await fetch(`${endpoint}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-observe")) });
  const observe = async (captureId: string) => recordOf(await readJson((await fetch(`${endpoint}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ name: "ae_observe_frame", arguments: { captureId, waitSeconds: 0 } }) }))), "");
  const capture = async (summary?: JsonObject) => {
    await fetch(`${endpoint}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ name: "ae_capture_composition_frame", arguments: { time: 1, maxEncodedBytes: 65536 } }) });
    const claimed = claimResponse(sidecar);
    const id = textOf(await readJson(claimed), "item.command.captureId");
    const posted = await fetch(`${endpoint}/v1/captures`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ captureId: id, ok: true, providerShared: false, dataUrl: "data:image/png;base64,aGVsbG8=", originalWidth: 1920, originalHeight: 1080, previewWidth: 1280, previewHeight: 720, resized: true, ...(summary === undefined ? {} : { summary }) }) });
    assert.equal(posted.status, 201);
    return id;
  };
  const measured = { width: 1920, height: 1080, background: [10, 10, 12], contentFraction: 0.25, transparentFraction: 0, regionContent: [1, 1, 1, 0, 0, 0, 0, 0, 0], contentBox: { x: 0, y: 0, width: 1, height: 0.333 }, dominantColors: [{ hex: "#ffffff", fraction: 0.25 }] };

  const id = await capture(measured);
  const observed = await observe(id);
  assert.equal(observed.ok, true, JSON.stringify(observed).slice(0, 200));
  const summary = maybeRecordOf(observed, "data.summary");
  assert.equal(fieldOf(summary, "contentFraction"), 0.25, "the measurement reaches the agent");
  assert.deepEqual(fieldOf(summary, "regionContent"), measured.regionContent, "and so does the grid that says where the content is");
  assert.equal(listOf(summary, "background").join(","), "10,10,12", "with the colour it was measured against, which is the difference between a flash and an empty frame");
  assert.equal(maybeTextOf(observed, "data.status"), "completed");

  const bad = await capture({ ...measured, contentFraction: 5 });
  const badObserved = await observe(bad);
  assert.equal(badObserved.ok, true, "a rejected measurement does not fail the capture it rode in on");
  assert.equal(fieldOf(badObserved, "data.summary"), null);
  assert.match(String(maybeTextOf(badObserved, "data.next")), /never measured|never.*measured|measurement/i);

  const unmeasured = await observe(await capture());
  assert.equal(unmeasured.ok, true);
  assert.equal(fieldOf(unmeasured, "data.summary"), null);
  assert.match(String(maybeTextOf(unmeasured, "data.next")), /measurement/i);
  const missing = await observe("frame-nothing-here");
  assert.equal(missing.ok, false);
  assert.equal(maybeTextOf(missing, "error.code"), "CAPTURE_NOT_FOUND");
});

test("a panel that cannot import the summariser sends a small grid, and the measurement happens here", async (t) => {
  const sidecar = sidecarFor({ port: 0, token, panelSessionId: "panel-sample", now: () => new Date("2026-09-11T12:00:00.000Z") });
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  const endpoint = `http://${address.host}:${address.port}`;
  await fetch(`${endpoint}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-sample")) });
  const capture = async (extra: JsonObject) => {
    await fetch(`${endpoint}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ name: "ae_capture_composition_frame", arguments: { time: 1, maxEncodedBytes: 65536 } }) });
    const id = textOf(await readJson(claimResponse(sidecar)), "item.command.captureId");
    assert.equal((await fetch(`${endpoint}/v1/captures`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ captureId: id, ok: true, providerShared: false, dataUrl: "data:image/png;base64,aGVsbG8=", originalWidth: 1920, originalHeight: 1080, previewWidth: 1280, previewHeight: 720, resized: true, ...extra }) })).status, 201);
    return recordOf(await readJson((await fetch(`${endpoint}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ name: "ae_observe_frame", arguments: { captureId: id, waitSeconds: 0 } }) }))), "");
  };

  const grid = Buffer.from(Array.from({ length: 16 }).flatMap((_, index) => index < 4 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
  const measured = await capture({ sampledPixels: { width: 4, height: 4, rgba: grid.toString("base64") } });
  assert.equal(measured.ok, true);
  assert.equal(fieldOf(measured, "data.summary.contentFraction"), 0.25, "a quarter of the sampled frame differs from its backdrop");
  assert.equal(listOf(measured, "data.summary.regionContent").length, 9, "and it is reported on the same 3x3 grid as a summary computed anywhere else");
  assert.deepEqual(listOf(measured, "data.summary.regionContent").slice(6), [0, 0, 0], "the bottom of the frame is empty, which is what makes this a direction");

  const oversized = await capture({ sampledPixels: { width: 400, height: 400, rgba: grid.toString("base64") } });
  assert.equal(oversized.ok, true, "a refused grid does not fail the capture that carried it");
  assert.equal(fieldOf(oversized, "data.summary"), null);
});

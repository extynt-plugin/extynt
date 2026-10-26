/** An apply the host never finished (After Effects quit mid-apply) is logged once and charged to the operation it was running. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MockProvider } from "@extynt/llm";
import { decode, type JsonValue } from "@extynt/decode";
import { interruptedApply } from "../src/interrupted-apply-wire.js";
import { fieldOf, textOf } from "./http-json.js";
import { authorization, chatTurn, claimResponse, matchingFocus, mutableSnapshot, queueScript, sidecarFor, token } from "./sidecar-fixture.js";

const interrupted = { planId: "plan-mufnx0ev-dt5sg4", index: 16, operationCount: 20, operation: "reorder_layer", layerId: "__new__:layer0", startedAt: "1790262248421" };

type TestSidecar = ReturnType<typeof sidecarFor>;
function planFor(sidecar: TestSidecar, planId: string) {
  const record = sidecar.plans.get(planId);
  assert.ok(record);
  return record;
}
function batchFor(sidecar: TestSidecar, planId: string) {
  const batch = sidecar.workflowCoordinator.batchForPlan(planId);
  assert.ok(batch);
  return batch;
}

test("a snapshot that reports an interrupted apply is logged once and steers the next briefing away from that operation", async (t) => {
  const stateDirectory = mkdtempSync(join(tmpdir(), "ae-interrupted-"));
  const sidecar = sidecarFor({ port: 0, token, stateDirectory, chatProvider: new MockProvider({ answer: "ok" }), quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const post = async (requestId: string) => {
    const base = mutableSnapshot(requestId);
    const snapshot = { ...base, result: { ...base.result, interruptedApply: interrupted } };
    const response = await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(snapshot) });
    assert.equal(response.status, 201);
  };
  await post("interrupted-1");
  await post("interrupted-2");
  const events = readFileSync(join(String(sidecar.options.stateDirectory), "pipeline.log"), "utf8").split("\n").filter((line) => line.includes("host.apply-interrupted"));
  assert.equal(events.length, 1, "the same interrupted apply is reported on every probe until the next apply, and logged once");
  assert.match(events[0] ?? "", /"planId":"plan-mufnx0ev-dt5sg4".*"index":16.*"operation":"reorder_layer"/);
  const host = Object.values(sidecar.runtimeEvidence.hosts)[0] ?? {};
  assert.equal(host.reorder_layer?.failures, 1);
  assert.equal(host.reorder_layer?.lastFailureBasis, "host-quit-during-apply");
});

const reportedApply = (report: JsonValue) => { const decoded = decode(interruptedApply, report); assert.ok(decoded.ok); return decoded.value; };

test("a malformed interrupted-apply report is ignored", () => {
  assert.equal(reportedApply({ planId: "bad id with spaces", index: 1 }), undefined);
  assert.equal(reportedApply({ planId: "plan-1", index: -1 }), undefined);
  assert.deepEqual(reportedApply({ planId: "plan-1", index: 2, operation: "Not An Op", layerId: 7 }), { planId: "plan-1", index: 2, operationCount: null, operation: null, layerId: null, startedAt: null });
});

const sealWithoutWaiting = (input: Parameters<ReturnType<typeof queueScript>>[0]) => {
  const step = queueScript("interrupted", "Next")(input);
  return { ...step, toolCalls: step.toolCalls.map((call) => call.name === "ae_queue_finish" ? { ...call, arguments: { waitSeconds: 0 } } : call) };
};

test("an interrupted applying plan becomes unknown, briefs the next turn, and releases the dispatch lane", async (t) => {
  const provider = new MockProvider({ script: sealWithoutWaiting });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  const post = <T>(path: string, body: T) => fetch(`${base}${path}`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await post("/v1/snapshots", mutableSnapshot("interrupted-before"))).status, 201);
  assert.equal((await post("/v1/panel/focus", matchingFocus())).status, 200);

  const planned = await chatTurn(address, "rename this to Next");
  const planId = textOf(planned.plans[0], "planId");
  assert.equal(planned.outcome, "planned");
  const approved = await post("/v1/mcp/tools/call", { name: "ae_approve_plan", arguments: { planId, acknowledgeUnverified: true, waitSeconds: 0 } });
  assert.equal(approved.status, 200);
  const claimed = claimResponse(sidecar); assert.equal(claimed.status, 200, await claimed.clone().text());
  const begin = await post("/v1/pipeline", { event: "apply-begin", detail: `${planId} 1 operations` });
  assert.equal(begin.status, 200);
  assert.equal(sidecar.plans.get(planId)?.status, "applying");
  assert.equal(sidecar.workflowCoordinator.batchForPlan(planId)?.lifecycle, "executing");

  const after = mutableSnapshot("interrupted-after");
  const interruptedSnapshot = { ...after, result: { ...after.result, interruptedApply: { ...interrupted, planId } } };
  assert.equal((await post("/v1/snapshots", interruptedSnapshot)).status, 201);

  const failed = planFor(sidecar, planId);
  assert.ok(failed.receipt);
  assert.equal(failed.receipt.status, "unknown");
  assert.equal(fieldOf(failed.receipt, "error.code"), "HOST_QUIT_DURING_APPLY");
  assert.equal(batchFor(sidecar, planId).lifecycle, "settled");
  assert.equal(batchFor(sidecar, planId).execution.state, "unknown");
  assert.equal(sidecar.workflowCoordinator.workflowStore.getState().activeDispatchLease, null);
  assert.equal(sidecar.inFlight, undefined, "the host claim is released with the workflow lane");

  await expectNextBriefing({ address, sidecar, provider });
});

interface BriefingRig { address: { host: string; port: number }; sidecar: TestSidecar; provider: MockProvider }

async function expectNextBriefing({ address, sidecar, provider }: BriefingRig) {
  const next = await chatTurn(address, "continue with the next batch");
  assert.equal(next.outcome, "planned");
  const nextPlan = next.plans[0];
  assert.ok(nextPlan);
  assert.equal(batchFor(sidecar, nextPlan.planId).lifecycle, "queued");
  const lastStep = provider.stepInputs.at(-1);
  assert.ok(lastStep);
  const briefing = lastStep.system;
  assert.match(briefing, /After Effects quit during apply at step 17 of 20 \(reorder_layer, __new__:layer0\)/);
  assert.match(briefing, /Do not repeat that operation the same way/);
}

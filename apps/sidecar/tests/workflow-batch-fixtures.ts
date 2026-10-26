// The rig the batch settlement tests share: a sidecar the test plays the host for, the tool and receipt calls it makes, and a sealed-and-applied batch.
import type { JsonObject } from "@extynt/decode";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { fieldOf, maybeTextOf, readJson, recordOf, textOf, type JsonObject as Reading } from "./http-json.js";
import { authorization, claimResponse, mutableSnapshot, receiptResponse, sidecarFor, token, withVerificationAck } from "./sidecar-fixture.js";

type Snapshot = ReturnType<typeof mutableSnapshot>;

/** What a test posts to the sidecar: a receipt or other JSON body, or a snapshot. */
export type PostBody = JsonObject | Snapshot;

/** A batch that was sealed and applied: its plan and the job it belongs to. */
export type AppliedBatch = { readonly planId: string; readonly jobId: string };

/** A sidecar the test plays the host for. */
export type Rig = {
  readonly post: (path: string, body: PostBody) => Promise<Response>;
  readonly agent: (name: string, args?: JsonObject) => Promise<Reading>;
  readonly claim: () => Promise<Reading>;
  readonly claimNow: () => Promise<Reading | null>;
  readonly sealAndApply: (summary: string, jobId: string | undefined, stamp: string) => Promise<AppliedBatch>;
  readonly undoReceipt: (planId: string) => Promise<Reading>;
};

async function claimUntilItem(sidecar: ReturnType<typeof sidecarFor>): Promise<Reading> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const item = fieldOf(await readJson(claimResponse(sidecar)), "item");
    if (item) return recordOf(item, "");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("no mailbox item");
}

function applyReceipt(planId: string, approvalId: string, beforeFingerprint: string): JsonObject {
  return { planId, approvalId, operation: "apply_plan", status: "executed", postcondition: "passed", appliedOperations: ["set_layer_name"], mayHaveMutated: true, mutationState: "applied", beforeFingerprint, undoGroups: 1 };
}

/** Starts a sidecar the test plays the host for and returns the calls it makes; the sidecar stops with the test. */
export async function startRig(t: TestContext, panelSessionId: string): Promise<Rig> {
  const sidecar = sidecarFor({ port: 0, token, panelSessionId, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  const post = (path: string, body: PostBody) => path === "/v1/receipts" ? receiptResponse(sidecar, body) : fetch(`${base}${path}`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(body) });
  const agent = async (name: string, args: JsonObject = {}) => recordOf(await readJson(await fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", "X-AE-Client": "agent" }, body: JSON.stringify({ name, arguments: { waitSeconds: 0, ...withVerificationAck(name, args) } }) })), "");
  const claimNow = async () => {
    const item = fieldOf(await readJson(claimResponse(sidecar)), "item");
    return item === null ? null : recordOf(item, "");
  };
  const claim = () => claimUntilItem(sidecar);
  const sealAndApply = async (summary: string, jobId: string | undefined, stamp: string): Promise<AppliedBatch> => {
    const created = await agent("ae_plan_create", jobId ? { summary, jobId } : { summary });
    assert.equal(created.ok, true, JSON.stringify(created));
    const planId = textOf(created, "data.planId");
    const added = await agent("ae_plan_add", { planId, operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name: stamp }] });
    assert.equal(added.ok, true, JSON.stringify(added));
    const sealed = await agent("ae_plan_complete", { planId });
    assert.equal(sealed.ok, true, JSON.stringify(sealed));
    const approved = await agent("ae_approve_plan", { planId });
    assert.equal(approved.ok, true, JSON.stringify(approved));
    assert.equal(fieldOf(await claim(), "planId"), planId);
    await post("/v1/snapshots", mutableSnapshot(`apply-${stamp}`, ["layer-1"], stamp));
    await post("/v1/receipts", applyReceipt(planId, textOf(approved, "data.approval.token"), textOf(sealed, "data.plan.snapshotFingerprint")));
    assert.equal(maybeTextOf(await agent("ae_get_plan_status", { planId }), "data.status"), "verified", `batch ${stamp} must have applied before the job undo is asked for`);
    return { planId, jobId: textOf(created, "data.jobId") };
  };
  const undoReceipt = async (planId: string) => recordOf(await readJson(await post("/v1/receipts", { planId, operation: "undo_plan", status: "executed", executed: true, method: "edit-undo", times: 1 })), "");
  return { post, agent, claim, claimNow, sealAndApply, undoReceipt };
}

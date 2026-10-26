// The rig the workflow lifecycle tests share: a sidecar with a scripted model, the calls a panel, an agent and a host make against it, and the plan one chat turn leaves approved and applied.
import type { JsonObject } from "@extynt/decode";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import type { ReadOnlySidecar } from "../src/server.js";
import { present } from "./agent-test-support.js";
import { fieldOf, readJson, recordOf, textOf, type JsonObject as Reading } from "./http-json.js";
import { authorization, chatTurn, claimResponse, mutableSnapshot, receiptResponse, sidecarFor, token, withVerificationAck } from "./sidecar-fixture.js";
import type { PostBody } from "./workflow-batch-fixtures.js";

type Options = Omit<ConstructorParameters<typeof ReadOnlySidecar>[0], "port" | "token">;

/** A running sidecar and the calls a test makes against it. */
export type Lifecycle = {
  readonly sidecar: ReadOnlySidecar;
  readonly address: { readonly host: string; readonly port: number };
  readonly base: string;
  readonly post: (path: string, body: PostBody, headers?: Readonly<Record<string, string>>) => Promise<Response>;
  readonly get: (path: string) => Promise<Response>;
  readonly status: () => Promise<Reading>;
  readonly call: (name: string, args?: JsonObject) => Promise<Reading>;
};

/** A plan one chat turn left approved and in the host's hands, with the approval it carries and the fingerprint the project started from. */
export type ClaimedPlan = { readonly planId: string; readonly approvalId: string; readonly initialFingerprint: string };

/** Starts a sidecar with these options; it stops with the test. */
export async function startLifecycle(t: TestContext, options: Options): Promise<Lifecycle> {
  const sidecar = sidecarFor({ port: 0, token, quietAgentLog: true, ...options });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  const post = (path: string, body: PostBody, headers: Readonly<Record<string, string>> = {}) => path === "/v1/receipts" ? receiptResponse(sidecar, body) : fetch(`${base}${path}`, { method: "POST", headers: { ...authorization, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const get = (path: string) => fetch(`${base}${path}`, { headers: authorization });
  const status = async () => recordOf(await readJson(await get("/v1/workflow/status")), "");
  const call = async (name: string, args: JsonObject = {}) => recordOf(await readJson(await post("/v1/mcp/tools/call", { name, arguments: { waitSeconds: 0, ...withVerificationAck(name, args) } }, { "x-ae-client": "agent" })), "");
  return { sidecar, address, base, post, get, status, call };
}

/** Sets the panel to ask before applying anything. */
export async function askBeforeApplying(life: Lifecycle): Promise<void> {
  await fetch(`${life.base}/v1/ui/prefs`, { method: "PATCH", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ askBeforeApplying: "always" }) });
}

/** Approves the plan as an agent client and answers the status and the approval token. */
export async function approvePlan(life: Lifecycle, planId: string): Promise<{ readonly status: number; readonly approvalId: string }> {
  const approved = await life.post("/v1/mcp/tools/call", { name: "ae_approve_plan", arguments: { planId, acknowledgeUnverified: true, waitSeconds: 0 } }, { "x-ae-client": "agent" });
  const status = approved.status;
  return { status, approvalId: status === 200 ? textOf(await readJson(approved), "data.approval.token") : "" };
}

/** Tells the sidecar the host began applying the plan. */
export async function beginApply(life: Lifecycle, planId: string): Promise<Response> {
  return life.post("/v1/pipeline", { event: "apply-begin", detail: `${planId} 1 operations` });
}

/** The receipt of a verified single-rename apply, with any further fields. */
export function verifiedApply(planId: string, approvalId: string, receiptId: string, extra: JsonObject = {}): JsonObject {
  const basis = "headless undo fixture";
  return { planId, approvalId, receiptId, operation: "apply_plan", status: "executed", postcondition: "passed", appliedOperations: ["set_layer_name"], mayHaveMutated: true, mutationState: "applied", verification: { state: "exact", basis, steps: [{ operation: "set_layer_name", verificationState: "exact", observed: true, basis }] }, ...extra };
}

/** Runs one chat turn that plans a rename of the title, then approves the plan, claims it as the host and begins applying it. */
export async function claimedRename(life: Lifecycle, tag: string): Promise<ClaimedPlan> {
  const initial = await life.post("/v1/snapshots", mutableSnapshot(`${tag}-before`));
  const initialFingerprint = textOf(await readJson(initial), "fingerprint");
  const response = await chatTurn(life.address, "rename this to Hero");
  assert.equal(response.outcome, "planned");
  const planId = present(response.plans[0]).planId;
  const approved = await life.call("ae_approve_plan", { planId });
  assert.equal(approved.ok, true);
  assert.ok(fieldOf(await readJson(await claimResponse(life.sidecar)), "item"));
  await life.post("/v1/snapshots", mutableSnapshot(`${tag}-claim`));
  assert.equal((await beginApply(life, planId)).status, 200);
  await life.post("/v1/snapshots", mutableSnapshot(`${tag}-applied`, ["layer-1"], "Hero"));
  return { planId, approvalId: textOf(approved, "data.approval.token"), initialFingerprint };
}

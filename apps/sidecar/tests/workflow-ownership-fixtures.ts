// The rig the ownership and resume tests share: a sidecar over a scripted provider, the panel and host calls against it, a claimed batch and a persisted job.
import type { JsonObject } from "@extynt/decode";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { MockProvider, type AgentStepInput, type AgentStepResult } from "@extynt/llm";
import { createPersistentWorkflowStore } from "@extynt/workflow";
import { mockAgentScript } from "../src/llm-mock-agent.js";
import type { ReadOnlySidecar } from "../src/server.js";
import { WorkflowCoordinator } from "../src/workflow-coordinator.js";
import { maybeFlagOf, readJson, recordOf, textOf } from "./http-json.js";
import { authorization, claimResponse, mutableSnapshot, receiptResponse, sidecarFor, token } from "./sidecar-fixture.js";
import type { PostBody } from "./workflow-batch-fixtures.js";

/** A sidecar with a scripted provider and the calls a panel and a host make against it. */
export interface Harness {
  sidecar: ReadOnlySidecar;
  continuationOwners: Array<string | undefined>;
  providerCalls: { count: number; prompts: string[] };
  post(path: string, body: PostBody, extraHeaders?: Record<string, string>): Promise<Response>;
  get(path: string): Promise<Response>;
}

/** A batch the host claimed and began applying. */
export interface ClaimedBatch { planId: string; approvalId: string; jobId: string; batchId: string }

/** How the scripted provider behaves once a job is past its first cycle. */
export type HarnessOptions = { cycles?: number; providerFailure?: boolean; failEveryCall?: boolean; stateDirectory?: string; continuationGate?: Promise<never> };

function continuationCycle(system: string, messages: string): boolean {
  const cycle = /"cycle"\s*:\s*(\d+)/.exec(system)?.[1];
  return (cycle !== undefined && Number(cycle) >= 1) || messages.includes("readback");
}

function continuationOutcome(options: HarnessOptions, input: AgentStepInput): Promise<never> | AgentStepResult {
  if (options.continuationGate) return options.continuationGate;
  if (options.providerFailure) throw new Error("synthetic provider failure after the verified receipt");
  return mockAgentScript(input);
}

/** Starts a sidecar over a provider scripted by these options, paired and holding its first snapshot. */
export async function harness(t: TestContext, options: HarnessOptions = {}): Promise<Harness> {
  let activeSidecar: ReadOnlySidecar | undefined;
  const continuationOwners: Array<string | undefined> = [];
  const providerCalls: { count: number; prompts: string[] } = { count: 0, prompts: [] };
  const provider = new MockProvider({ script: (input) => {
    providerCalls.count += 1;
    providerCalls.prompts.push(JSON.stringify(input.messages));
    if (options.failEveryCall) throw new Error("synthetic provider failure");
    if (!continuationCycle(input.system, providerCalls.prompts.at(-1) ?? "")) return mockAgentScript(input);
    continuationOwners.push(activeSidecar?.activeChatTurn?.requestId);
    return continuationOutcome(options, input);
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, workflowMaxCycles: options.cycles ?? 3, quietAgentLog: true, ...(options.stateDirectory ? { stateDirectory: options.stateDirectory } : {}) });
  activeSidecar = sidecar;
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  const headers = { ...authorization, "content-type": "application/json", "X-AE-Panel-Instance": "ownership-panel" };
  const prefs = (autoApply: boolean) => fetch(`${base}/v1/ui/prefs`, { method: "PATCH", headers, body: JSON.stringify({ askBeforeApplying: autoApply ? "risky" : "always" }) });
  const post = async (path: string, body: PostBody, extraHeaders: Record<string, string> = {}) => {
    if (path === "/v1/receipts") return receiptResponse(sidecar, body);
    const autoApply = path === "/v1/chat" ? maybeFlagOf(body, "autoApply") : undefined;
    if (autoApply !== undefined) await prefs(autoApply);
    return fetch(`${base}${path}`, { method: "POST", headers: { ...headers, ...extraHeaders }, body: JSON.stringify(body) });
  };
  const get = (path: string) => path.startsWith("/v1/mailbox/claim") ? Promise.resolve(claimResponse(sidecar)) : fetch(`${base}${path}`, { headers });
  assert.equal((await get("/v1/pair")).status, 200);
  assert.equal((await post("/v1/snapshots", mutableSnapshot("ownership-initial"))).status, 201);
  return { sidecar, continuationOwners, providerCalls, post, get };
}

/** Starts a chat turn that asks for the rename and answers when the turn ends. */
export function beginChat(h: Harness, requestId: string, autoApply = true): Promise<Response> {
  return h.post("/v1/chat", { requestId, message: "rename to Hero", autoApply });
}

/** Waits for the sealed batch, approves it, claims it as the host and begins applying it. */
export async function claimBatch(h: Harness): Promise<ClaimedBatch> {
  assert.equal(await h.sidecar.waitUntil(() => h.sidecar.readyPlans.some((plan) => plan.deliveredAt === null), 2), true, "a bounded batch must be sealed");
  const ready = recordOf(await readJson(await h.get("/v1/chat/plans/ready")), "");
  const planId = textOf(ready, "plans.0.planId");
  const approved = await h.post("/v1/mcp/tools/call", { name: "ae_approve_plan", arguments: { planId, acknowledgeUnverified: true, waitSeconds: 0 } }, { "X-AE-Client": "agent" });
  assert.equal(approved.status, 200);
  const approvalId = textOf(await readJson(approved), "data.approval.token");
  const claimed = await h.get("/v1/mailbox/claim?waitSeconds=0");
  assert.equal(claimed.status, 200);
  assert.equal(textOf(await readJson(claimed), "item.planId"), planId);
  assert.equal((await h.post("/v1/pipeline", { event: "apply-begin", detail: `${planId} 1 operations` })).status, 200);
  const coordinator = h.sidecar.workflowCoordinator;
  const jobId = coordinator.jobIdForPlan(planId), batchId = coordinator.batchIdForPlan(planId);
  assert.ok(jobId); assert.ok(batchId);
  return { planId, approvalId, jobId, batchId };
}

/** The host's verified receipt of the claimed batch. */
export function verifiedBody(batch: ClaimedBatch, receiptId: string): JsonObject {
  const basis = "headless ownership fixture readback";
  return { planId: batch.planId, approvalId: batch.approvalId, receiptId, operation: "apply_plan", status: "executed", postcondition: "passed", appliedOperations: ["set_layer_name"], mayHaveMutated: true, mutationState: "applied", verification: { state: "exact", basis, steps: [{ operation: "set_layer_name", verificationState: "exact", observed: true, basis }] } };
}

/** A job on disk, left in this state by a sidecar that stopped. */
export function persistedJob(t: TestContext, blocker: string | null, failure?: { code: string; message: string }, closedCycles = 0): { directory: string; jobId: string } {
  const directory = mkdtempSync(join(tmpdir(), "ae-workflow-resume-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const coordinator = new WorkflowCoordinator({ store: createPersistentWorkflowStore({ filePath: join(directory, "workflow-store.json") }) });
  const jobId = coordinator.openJob("persisted-seed", "Animate the persisted brief", { requestId: "persisted-seed", autoApply: true });
  for (let cycle = 1; cycle <= closedCycles; cycle += 1) coordinator.closeProviderCycle(jobId, cycle);
  if (failure) coordinator.recordProviderFailure(jobId, failure.code, failure.message, true);
  if (blocker) coordinator.blockJob(jobId, blocker);
  coordinator.close();
  return { directory, jobId };
}

/** How many jobs the sidecar's ledger holds. */
export function jobCount(h: Harness): number {
  return Object.keys(h.sidecar.workflowCoordinator.workflowStore.getState().jobs).length;
}

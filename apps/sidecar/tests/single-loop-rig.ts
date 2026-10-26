/** The single-loop rig: scripted provider turns through the real sidecar, with a host that applies batches, returns verified receipts and answers frame captures. */
import { type TestContext } from "node:test";
import { MockProvider, type AgentStepInput, type AgentStepResult } from "@extynt/llm";
import type { DecisionModel } from "@extynt/decide";
import { maybeListOf, maybeNumberOf, maybeTextOf, readJson, recordsOf, textOf, type JsonObject } from "./http-json.js";
import { authorization, claimResponse, mutableSnapshot, receiptResponse, pause, sidecarFor, token, withVerificationAck } from "./sidecar-fixture.js";
import type { FrameCheckRow } from "../src/verify/frame-check.js";
import { present } from "./present.js";

export type Script = (input: AgentStepInput) => AgentStepResult | Promise<AgentStepResult>;
export type Rig = HostRig & { base: string; address: { host: string; port: number }; provider: MockProvider; stop: () => void };
type HostRig = { sidecar: ReturnType<typeof sidecarFor>; snapshotId: string; base: string; applied: string[]; approved: Set<string>; undone: string[]; batches: string[][]; mismatch?: boolean | number; stale?: { first: number; mayHaveMutated?: boolean; hostError?: { code: string; message: string }; failedAt?: { index: number; operation: string; rolledBack: boolean } }; frames?: (time: number) => JsonObject; captured?: number[]; distinctSnapshots?: boolean; bindCreated?: boolean; createdIds?: string[]; frameChecks?: (batch: number) => FrameCheckRow[] };

export const post = <T>(base: string, path: string, body: T) => fetch(`${base}${path}`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(body) });

function rigMismatches(rig: HostRig): boolean {
  return typeof rig.mismatch === "number" ? rig.applied.length <= rig.mismatch : rig.mismatch === true;
}

function readbackFor(types: string[], mismatched: boolean): JsonObject {
  if (mismatched) return { steps: types.map((operation) => ({ operation, observed: false, verificationState: "failed", basis: "layer-timing-mismatch", compositionId: "comp-1", layerId: "layer-1", expectedValue: 2, observedValue: 0 })) };
  if (types.some((type) => type.endsWith("?"))) return { state: "applied_unverified", basis: "fixture read-back", steps: types.map((type) => type.endsWith("?") ? { operation: type.slice(0, -1), verificationState: "applied_unverified", observed: false, basis: "shape-detail-unread" } : { operation: type, verificationState: "exact", observed: true, basis: "fixture read-back" }) };
  return { state: "exact", basis: "fixture read-back", steps: types.map((operation) => ({ operation, verificationState: "exact", observed: true, basis: "fixture read-back" })) };
}

interface StaleOutcome {
  planId: string;
  mayHaveMutated: boolean;
  approvalId: string;
  refusal?: { code: string; message: string } | undefined;
  failedAt?: { index: number; operation: string; rolledBack: boolean } | undefined;
}

const PLAN_CHANGED = { code: "STALE_SNAPSHOT", message: "The project changed between approval and apply, so nothing was run. The panel has refreshed; propose the plan again against the current state." };

function failedRefusal(outcome: StaleOutcome, failedAt: NonNullable<StaleOutcome["failedAt"]>): JsonObject {
  const { planId, mayHaveMutated, approvalId, refusal } = outcome;
  const failure = { phase: "apply", operationIndex: failedAt.index, operation: failedAt.operation };
  return { planId, operation: "apply_plan", status: "rejected", postcondition: mayHaveMutated ? "partial_mutation_possible" : "not_run", appliedOperations: [], completedOperations: [], mayHaveMutated, mutationState: failedAt.rolledBack ? "rolled-back" : "partial-applied", rollback: failedAt.rolledBack ? "Rolled back" : "After Effects Undo required", failure, ...(refusal === undefined ? {} : { hostError: refusal }), approvalId };
}

function staleRefusal(outcome: StaleOutcome): JsonObject {
  if (outcome.failedAt) return failedRefusal(outcome, outcome.failedAt);
  const { planId, mayHaveMutated, approvalId } = outcome;
  const hostError = outcome.refusal ?? PLAN_CHANGED;
  return { planId, operation: "apply_plan", status: "rejected", postcondition: mayHaveMutated ? "partial_mutation_possible" : "not_run", appliedOperations: [], mayHaveMutated, mutationState: mayHaveMutated ? "partial-applied" : "not-applied", hostError, approvalId };
}

async function refusedAsStale(rig: HostRig, planId: string, approvalId: string): Promise<boolean> {
  if (!rig.stale || rig.applied.length > rig.stale.first) return false;
  if (rig.stale.mayHaveMutated) await post(rig.base, "/v1/pipeline", { event: "apply-begin", detail: `${planId} 1 operations` });
  await receiptResponse(rig.sidecar, staleRefusal({ planId, mayHaveMutated: rig.stale.mayHaveMutated === true, approvalId, refusal: rig.stale.hostError, failedAt: rig.stale.failedAt }));
  return true;
}

/** What the panel measures on a frame the rings drew: a ring of content around the middle cell. */
export const RINGS_FRAME = { width: 1920, height: 1080, background: [10, 10, 12], contentFraction: 0.08, transparentFraction: 0, regionContent: [0, 0.05, 0, 0.05, 0.4, 0.05, 0, 0.05, 0], contentBox: { x: 0.36, y: 0.26, width: 0.27, height: 0.48 }, dominantColors: [{ hex: "#22d3ee", fraction: 0.08 }] };

async function answerCapture(rig: HostRig, captureId: string, time: number): Promise<void> {
  if (!captureId.startsWith("thumb-")) rig.captured?.push(time);
  await post(rig.base, "/v1/captures", { captureId, ok: true, providerShared: false, dataUrl: "data:image/png;base64,aGVsbG8=", originalWidth: 1920, originalHeight: 1080, previewWidth: 1280, previewHeight: 720, resized: true, summary: rig.frames?.(time) ?? RINGS_FRAME });
}

async function answerCommand(rig: HostRig, claimed: Awaited<ReturnType<typeof readJson>>): Promise<boolean> {
  if (maybeTextOf(claimed, "item.kind") === "undo_plan") {
    rig.undone.push(textOf(claimed, "item.planId"));
    await post(rig.base, "/v1/snapshots", mutableSnapshot(rig.snapshotId));
    await receiptResponse(rig.sidecar, { planId: textOf(claimed, "item.planId"), operation: "undo_plan", status: "executed", executed: true, method: "edit-undo", undo: { restoredPreApplyFingerprint: true } });
    return true;
  }
  if (maybeTextOf(claimed, "item.kind") !== "capture_frame") return false;
  await answerCapture(rig, textOf(claimed, "item.command.captureId"), maybeNumberOf(claimed, "item.command.time") ?? 0);
  return true;
}

function createdLayersOf(rig: HostRig, planId: string): Array<{ ordinal: number; placeholder: string; id: string }> {
  if (!rig.bindCreated) return [];
  const ids = (rig.createdIds ??= []);
  const operations = maybeListOf(rig.sidecar.plans.get(planId)?.plan, "operations") ?? [];
  const created: Array<{ ordinal: number; placeholder: string; id: string }> = [];
  operations.forEach((operation, ordinal) => {
    const placeholder = maybeTextOf(operation, "type") === "create_layer" ? maybeTextOf(operation, "target.layerId") : undefined;
    if (placeholder?.startsWith("__new__:")) created.push({ ordinal, placeholder, id: `layer-${101 + ids.length + created.length}` });
  });
  ids.push(...created.map((entry) => entry.id));
  return created;
}

function withCreated(verification: JsonObject, created: ReturnType<typeof createdLayersOf>): JsonObject {
  if (!created.length) return {};
  const steps = recordsOf(verification, "steps").map((row, ordinal) => {
    const bound = created.find((entry) => entry.ordinal === ordinal);
    return bound ? { ...row, compositionId: "comp-1", layerId: bound.id } : row;
  });
  return { verification: { ...verification, steps }, created: Object.fromEntries(created.map((entry) => [entry.placeholder, entry.id])) };
}

function appliedSnapshot(rig: HostRig) {
  const base = mutableSnapshot(rig.snapshotId, ["layer-1"], rig.distinctSnapshots ? `Applied ${rig.applied.length}` : "Applied");
  if (!rig.createdIds?.length) return base;
  const [comp] = base.result.compositions;
  const [first] = present(comp).layers;
  const layers = [present(first), ...rig.createdIds.map((id, index) => ({ ...present(first), id, index: index + 2, name: id, selected: false, type: "shape" }))];
  return { ...base, result: { ...base.result, compositions: [{ ...present(comp), layers }] } };
}

async function applyApproved(rig: HostRig, { planId, types, approvalId }: { planId: string; types: string[]; approvalId: string }): Promise<void> {
  const beforeFingerprint = rig.sidecar.normalizedLatest()?.fingerprint;
  await post(rig.base, "/v1/pipeline", { event: "apply-begin", detail: `${planId} 1 operations` });
  const created = createdLayersOf(rig, planId);
  await post(rig.base, "/v1/snapshots", appliedSnapshot(rig));
  const mismatched = rigMismatches(rig);
  const verification = readbackFor(types, mismatched);
  const receipt = { planId, operation: "apply_plan", status: "executed", postcondition: mismatched ? "failed" : "passed", appliedOperations: types.map((type) => type.replace(/\?$/, "")), mayHaveMutated: true, mutationState: "applied", undoGroups: 1, beforeFingerprint, verification, approvalId, ...withCreated(verification, created), ...(rig.frameChecks ? { frameChecks: rig.frameChecks(rig.applied.length - 1) } : {}) };
  await receiptResponse(rig.sidecar, receipt);
}

async function applyClaimed(rig: HostRig, claimed: Awaited<ReturnType<typeof readJson>>): Promise<void> {
  const planId = textOf(claimed, "item.planId"), approvalId = textOf(claimed, "item.approval.token");
  const types = rig.batches[rig.applied.length] ?? [];
  rig.applied.push(planId);
  if (await refusedAsStale(rig, planId, approvalId)) return;
  await applyApproved(rig, { planId, types, approvalId });
}

async function hostLoop(rig: HostRig, stopped: () => boolean): Promise<void> {
  while (!stopped()) {
    const claimed = await readJson(claimResponse(rig.sidecar));
    if (await answerCommand(rig, claimed)) continue;
    if (maybeTextOf(claimed, "item.planId") !== undefined) { await applyClaimed(rig, claimed); continue; }
    const ready = await readJson(await fetch(`${rig.base}/v1/chat/plans/ready`, { headers: authorization }));
    const planId = maybeTextOf(ready, "plans.0.planId");
    if (!planId || rig.approved.has(planId)) { await pause(10); continue; }
    rig.approved.add(planId);
    await post(rig.base, "/v1/mcp/tools/call", { name: "ae_approve_plan", arguments: withVerificationAck("ae_approve_plan", { planId }) });
  }
}

export function rigFor(t: TestContext, script: Script, snapshotId: string, ...rest: [batches: string[][], specialist?: MockProvider]): Promise<Rig> {
  const [batches, specialist] = rest;
  return rigWith(t, script, snapshotId, batches, specialist ? { workflowSpecialistProviders: { "visual-scene": specialist, motion: specialist } } : {});
}

async function specialistsIdle(holder: { sidecar?: ReturnType<typeof sidecarFor> }): Promise<void> {
  for (;;) {
    const running = [...(holder.sidecar?.workflowSpecialistSessions.values() ?? [])].flatMap((sessions) => [...sessions.values()]).flatMap((session) => (session.pending ? [session.pending] : []));
    if (running.length === 0) return;
    await Promise.allSettled(running);
  }
}

interface RigOptions { ownerWaitsForSpecialists?: boolean; workflowFreeRun?: boolean; workflowDesignApproval?: boolean; workflowSpecialistProviders?: Record<string, MockProvider>; quietAgentLog?: boolean; stateDirectory?: string; decisionModels?: () => ReadonlyArray<DecisionModel> }

async function ignoringStop(loop: Promise<void>, stopped: () => boolean): Promise<void> {
  try {
    await loop;
  } catch (error) {
    if (!stopped()) throw error;
  }
}

/** The rig with extra sidecar options (free run, specialists). */
export async function rigWith(t: TestContext, script: Script, snapshotId: string, ...rest: [batches: string[][], options: RigOptions]): Promise<Rig> {
  const [{ ownerWaitsForSpecialists, ...sidecarOptions }, batches] = [rest[1], rest[0]];
  const holder: { sidecar?: ReturnType<typeof sidecarFor> } = {};
  const provider = new MockProvider({ script: ownerWaitsForSpecialists ? async (input) => { await specialistsIdle(holder); return script(input); } : script });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true, ...sidecarOptions });
  holder.sidecar = sidecar;
  const address = await sidecar.start();
  const base = `http://${address.host}:${address.port}`;
  await post(base, "/v1/snapshots", mutableSnapshot(snapshotId));
  let done = false;
  const applied: string[] = [], undone: string[] = [];
  const rig = { sidecar, snapshotId, base, address, provider, batches, applied, approved: new Set<string>(), undone, stop: () => { done = true; } };
  const running = ignoringStop(hostLoop(rig, () => done), () => done);
  t.after(async () => { done = true; await running; await sidecar.stop(); });
  return rig;
}

export const toolCalls = (input: AgentStepInput) => input.messages.filter((message) => message.role === "tool").map((message) => message.name);
export const step = (id: string, name: string, args: JsonObject): AgentStepResult => ({ text: "", toolCalls: [{ id, name, arguments: args }] });

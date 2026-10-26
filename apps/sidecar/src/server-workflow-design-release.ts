/**
 * Queues animation held by the design-first split (server-workflow-design-hold.ts) once its layers exist and were checked: the design batch that declared
 * them has settled and verified, so its receipt binds each placeholder to a created id, and a frame of the built scene was observed. The model never
 * re-authors the held operations; it is told they were queued and seals them. A plan open when a name was held first is searched first for its binding,
 * then the job's other plans, newest first.
 */
import { PLAN_UNDO_BATCH_SIZE, declaredNames, type StoredPlan } from "@extynt/mcp-server";
import type { WorkflowId } from "@extynt/workflow";
import type { JsonObject } from "@extynt/decode";
import { appliedCreatedBindings } from "./server-contracts.js";
import type { ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import { takeJobFrame } from "./server-workflow-completion-evidence.js";
import { frameCheckBlocks, frameCheckMissing } from "./server-workflow-design.js";
import type { HeldAnimation } from "./server-workflow-design-hold.js";
import { queuedOperationCount } from "./server-workflow-design-receipts.js";
import { objectOf, payload, payloadOrWrapped, PLACEHOLDER_PREFIX, queueStaged, refusal, stringsIn, textOf, withIds, type Run, type ToolResult } from "./server-workflow-operation-json.js";
import { recordSidecarAction } from "./server-workflow-sidecar-actions.js";

type NameState = { readonly id: string } | "pending" | "failed";
type ReleaseWork = { readonly jobId: WorkflowId; readonly operations: JsonObject[]; readonly layers: readonly string[] };

/** What a release attempt did, for the note the model reads. */
export type HeldRelease =
  | { readonly status: "queued"; readonly count: number; readonly layers: readonly string[] }
  | { readonly status: "refused"; readonly operations: readonly JsonObject[]; readonly reason: string };

function workflowJob(deps: ChatAgentDeps, input: ChatAgentInput): WorkflowId | undefined {
  return input.workflowJobId ? deps.state.workflowCoordinator.jobIdForSeed(input.workflowJobId) : undefined;
}

function candidatePlans(deps: ChatAgentDeps, jobId: WorkflowId, planId: string | undefined): StoredPlan[] {
  const coordinator = deps.state.workflowCoordinator;
  const own = planId ? deps.state.plans.get(planId) : undefined;
  const job = [...deps.state.plans.values()].reverse().filter((record) => record !== own && coordinator.jobIdForPlan(record.plan.planId) === jobId);
  return own ? [own, ...job] : job;
}

export type SettledBatch = NonNullable<ReturnType<ChatAgentDeps["state"]["workflowCoordinator"]["batchForPlan"]>>;

function appliedUnverified(batch: SettledBatch): boolean {
  return batch.verification.state === "applied_unverified" && batch.execution.state === "executed" && batch.execution.mutation === "applied";
}

function boundIn(deps: ChatAgentDeps, record: StoredPlan, canonical: string): NameState {
  const batch = deps.state.workflowCoordinator.batchForPlan(record.plan.planId);
  if (!batch || batch.lifecycle !== "settled") return "pending";
  const id = batch.recovery.state === "undone" ? undefined : boundId(batch, record, canonical);
  return id ? { id } : "failed";
}

/**
 * The id a settled batch bound to a placeholder, or undefined when it never did (the batch did not apply). A batch that ran binds the ids its creating steps
 * were read back with even when it is only applied_unverified, which is a batch that ran in After Effects but whose read-back could not prove every detail
 * (for example a composition marker row it cannot serialise): the layers exist, so the animation held for them is not lost (the engine's own bindings stay
 * verified-only; this is the sidecar's release rule).
 */
export function boundId(batch: SettledBatch, record: StoredPlan, canonical: string): string | undefined {
  if (batch.verification.state === "verified") return batch.execution.receipt?.createdBindings?.find((entry) => entry.placeholder === canonical)?.createdId;
  return appliedUnverified(batch) ? appliedCreatedBindings(record)[canonical] : undefined;
}

function nameState(deps: ChatAgentDeps, plans: readonly StoredPlan[], name: string): NameState {
  for (const record of plans) {
    const canonical = record.placeholderBindings?.[name];
    if (canonical) return boundIn(deps, record, canonical);
    const direct = boundIn(deps, record, name);
    if (typeof direct === "object") return direct;
  }
  return "pending";
}

function resolveHold(deps: ChatAgentDeps, jobId: WorkflowId, hold: HeldAnimation): JsonObject[] | "pending" | "failed" {
  const own = new Set(hold.operations.flatMap((operation) => declaredNames(operation)));
  const borrowed = [...new Set(stringsIn([...hold.operations]).filter((text) => text.startsWith(PLACEHOLDER_PREFIX)))].filter((name) => !own.has(name));
  const plans = candidatePlans(deps, jobId, hold.planId);
  const ids = new Map<string, string>();
  for (const name of borrowed) {
    const state = nameState(deps, plans, name);
    if (typeof state !== "object") return state;
    ids.set(name, state.id);
  }
  return hold.operations.map((operation) => withIds(operation, ids));
}

function readyOperations(deps: ChatAgentDeps, jobId: WorkflowId, holds: readonly HeldAnimation[]): { ready: JsonObject[]; layers: string[]; waiting: HeldAnimation[] } {
  const ready: JsonObject[] = [], layers: string[] = [], waiting: HeldAnimation[] = [];
  for (const hold of holds) {
    const resolved = resolveHold(deps, jobId, hold);
    if (typeof resolved === "string") { waiting.push(hold); continue; }
    ready.push(...resolved);
    layers.push(...hold.layers);
  }
  return { ready, layers, waiting };
}

function keepWaiting(deps: ChatAgentDeps, jobId: WorkflowId, waiting: HeldAnimation[], overflow: JsonObject[]): void {
  const left = overflow.length ? [...waiting, { planId: undefined, operations: overflow, layers: [] }] : waiting;
  if (left.length) deps.state.workflowHeldAnimation.set(jobId, left);
  else deps.state.workflowHeldAnimation.delete(jobId);
}

function releaseRefusal(result: ToolResult, operations: JsonObject[]): HeldRelease {
  const data = payload(result) ?? {};
  const next = textOf(data.next);
  const reason = result.ok ? `${JSON.stringify(data.fix ?? [])}${next === undefined ? "" : ` ${next}`}` : `${result.error.code}: ${result.error.message}`;
  return { status: "refused", operations, reason };
}

function releasableJob(deps: ChatAgentDeps, input: ChatAgentInput): { jobId: WorkflowId; holds: HeldAnimation[] } | undefined {
  const jobId = workflowJob(deps, input);
  const holds = jobId ? deps.state.workflowHeldAnimation.get(jobId) : undefined;
  if (!jobId || !holds?.length || deps.state.workflowHeldReleasing.has(jobId)) return undefined;
  return input.workflowObservationOnly || frameCheckBlocks(deps, input) ? undefined : { jobId, holds };
}

async function queueReleased(deps: ChatAgentDeps, work: ReleaseWork, run: Run): Promise<HeldRelease> {
  const { jobId, operations, layers } = work;
  deps.state.workflowHeldReleasing.add(jobId);
  try {
    const result = await run("ae_queue_add", { summary: `Animate the built design: ${layers.join(", ")}`.slice(0, 240), operations });
    if (!queueStaged(result)) return releaseRefusal(result, operations);
    if (deps.state.openQueuePlanId) deps.state.workflowHeldReleasedInto.set(jobId, { planId: deps.state.openQueuePlanId, count: operations.length, layers });
    recordSidecarAction(deps.state, jobId, `queued your ${operations.length} held animation operation(s) for ${layers.join(", ")} after the design was checked`);
    return { status: "queued", count: operations.length, layers };
  } finally {
    deps.state.workflowHeldReleasing.delete(jobId);
  }
}

/**
 * Queues the job's held animation when its layers are built, verified and frame-checked and the batch has room after `reserve` slots the caller still needs.
 * Undefined when nothing was held or it is not time yet: no animation held, a release already running, a read-only cycle, or no frame check yet. It waits,
 * it is never dropped here.
 */
export async function releaseHeldAnimation(deps: ChatAgentDeps, input: ChatAgentInput, run: Run, reserve = 0): Promise<HeldRelease | undefined> {
  const job = releasableJob(deps, input);
  if (!job) return undefined;
  const { ready, layers, waiting } = readyOperations(deps, job.jobId, job.holds);
  const room = PLAN_UNDO_BATCH_SIZE - queuedOperationCount(deps) - reserve;
  if (!ready.length || room < 1) return undefined;
  keepWaiting(deps, job.jobId, waiting, ready.slice(room));
  return queueReleased(deps, { jobId: job.jobId, operations: ready.slice(0, room), layers: [...new Set(layers)] }, run);
}

const REFUSED_RELEASE = "The sidecar tried to queue the animation it held from the design call, but the queue refused it";

/** True when the result carries the note of a release the queue refused, so the model still owes those operations. */
export function releaseRefused(result: ToolResult): boolean {
  const note = textOf(payload(result)?.heldAnimation);
  return note !== undefined && note.startsWith(REFUSED_RELEASE);
}

/** True when held animation was just released into the batch that is open now, which no one has sealed yet. */
export function releasedIntoOpenQueue(deps: ChatAgentDeps, input: ChatAgentInput): boolean {
  const jobId = workflowJob(deps, input);
  const released = jobId ? deps.state.workflowHeldReleasedInto.get(jobId) : undefined;
  return !!released && released.planId === deps.state.openQueuePlanId;
}

function releaseNote(release: HeldRelease): string {
  if (release.status === "queued") return `The sidecar queued the ${release.count} animation operation(s) it held from the design call (${release.layers.join(", ")}), rebound to the built layers' ids, into this batch. Do not author them again; seal with ae_queue_finish when the batch is whole.`;
  return `${REFUSED_RELEASE} (${release.reason}). These are those operations, already rebound to the built layers — correct what the refusal names and send them with ae_queue_add: ${JSON.stringify(release.operations)}`;
}

/** Attaches a release note to a tool result. */
export function withReleaseNote(result: ToolResult, release: HeldRelease | undefined): ToolResult {
  if (!release) return result;
  const note = releaseNote(release);
  if (!result.ok) return { ...result, error: { ...result.error, message: `${result.error.message} ${note}` } };
  return { ...result, data: { ...payloadOrWrapped(result), heldAnimation: note } };
}

/**
 * A seal measures its own frame (measureSettledFrame), and that observation may release held animation; the note then sits inside the receipt's frame.
 * It is lifted onto the seal's own answer and leads its `next`, where the model reads what to do now.
 */
export function liftedFrameRelease(result: ToolResult): ToolResult {
  const data = payload(result);
  if (!result.ok || !data) return result;
  const receipt = objectOf(data.receipt) ?? {};
  const frame = objectOf(receipt.frame) ?? {};
  const note = textOf(frame.heldAnimation);
  if (note === undefined) return result;
  const measured = Object.fromEntries(Object.entries(frame).filter(([key]) => key !== "heldAnimation"));
  return { ...result, data: { ...data, receipt: { ...receipt, frame: measured }, heldAnimation: note, next: `${note} ${textOf(data.next) ?? ""}`.trim() } };
}

/** True when the job holds animation that waits only on a frame of the built scene, which the seal's own measurement can supply. */
export function heldAwaitsFrame(deps: ChatAgentDeps, jobId: WorkflowId): boolean {
  return !!deps.state.workflowHeldAnimation.get(jobId)?.length && frameCheckMissing(deps.state.workflowCoordinator.workflowStore.getState(), jobId);
}

function heldCount(holds: readonly HeldAnimation[]): number {
  return holds.reduce((sum, hold) => sum + hold.operations.length, 0);
}

function heldLayers(holds: readonly HeldAnimation[]): string {
  return [...new Set(holds.flatMap((hold) => hold.layers))].join(", ") || "the new layers";
}

function waitingReason(deps: ChatAgentDeps, input: ChatAgentInput, jobId: WorkflowId, holds: readonly HeldAnimation[]): "frame" | "pending" | "failed" | "observation" {
  if (input.workflowObservationOnly) return "observation";
  if (holds.some((hold) => resolveHold(deps, jobId, hold) === "failed")) return "failed";
  return frameCheckBlocks(deps, input) ? "frame" : "pending";
}

const WAITING: Record<"frame" | "pending" | "observation", string> = {
  frame: "the sidecar has checked a frame of the built scene (it takes that frame itself when the design batch settles, and again at completion) — no capture of your own is needed; it then queues them for you",
  pending: "the design batch has applied and verified — seal it with ae_queue_finish if it is still open; the sidecar then queues them for you",
  observation: "this read-only check ends — the next build cycle queues them for you; end this cycle without completing",
};

/** The live-state line for a job with held or just-released animation, so a fresh cycle knows the work is not lost. */
export function heldAnimationState(deps: ChatAgentDeps, input: ChatAgentInput): string | undefined {
  const jobId = workflowJob(deps, input);
  if (!jobId) return undefined;
  const released = deps.state.workflowHeldReleasedInto.get(jobId);
  if (released && released.planId === deps.state.openQueuePlanId) return `Held animation: the sidecar queued your ${released.count} animation operation(s) for ${released.layers.join(", ")} into this open batch after the design was checked. Do not author them again; add anything else the stage needs, then seal with ae_queue_finish.`;
  const holds = deps.state.workflowHeldAnimation.get(jobId);
  if (!holds?.length) return undefined;
  const reason = waitingReason(deps, input, jobId, holds);
  if (reason === "failed") return `Held animation: ${heldCount(holds)} animation operation(s) for ${heldLayers(holds)} wait on a design batch that did not verify, so their layers have no confirmed ids. Rebuild those layers; completing the job reports the held operations for you to queue against what exists.`;
  return `Held animation: the sidecar holds ${heldCount(holds)} animation operation(s) for ${heldLayers(holds)} from your design call. They are queued automatically once ${WAITING[reason]}. Do not author them again.`;
}

function heldRefusal(message: string): ToolResult {
  return refusal("WORKFLOW_HELD_ANIMATION", message);
}

function waitingRefusal(deps: ChatAgentDeps, input: ChatAgentInput, work: { jobId: WorkflowId; holds: readonly HeldAnimation[] }): ToolResult {
  const { jobId, holds } = work;
  const reason = waitingReason(deps, input, jobId, holds);
  if (reason !== "failed") return heldRefusal(`Not finished yet: ${heldCount(holds)} animation operation(s) for ${heldLayers(holds)} are held until ${WAITING[reason]}.`);
  deps.state.workflowHeldAnimation.delete(jobId);
  return heldRefusal(`Not finished yet: the design batch that created ${heldLayers(holds)} did not verify, so the ${heldCount(holds)} animation operation(s) held for it could not be bound and were released to you. Queue them with ae_queue_add against the layers that exist now (replace each __new__ name with the layer's id): ${JSON.stringify(holds.flatMap((hold) => hold.operations))}`);
}

/**
 * Completion with held animation is not complete: release it now when it can go, otherwise say what it waits on. A hold whose design never verified can never
 * bind, so it is dropped and its operations are handed back for the model to queue against what exists. The frame check is the sidecar's to take: completing
 * must not wait for the model to capture and observe by hand.
 */
export async function heldCompletionRefusal(deps: ChatAgentDeps, input: ChatAgentInput, run: Run): Promise<ToolResult | undefined> {
  const jobId = workflowJob(deps, input);
  const holds = jobId ? deps.state.workflowHeldAnimation.get(jobId) : undefined;
  if (!jobId || !holds?.length) return undefined;
  if (!input.workflowObservationOnly && frameCheckBlocks(deps, input)) await takeJobFrame(deps, jobId, run);
  const release = await releaseHeldAnimation(deps, input, run);
  return release ? heldRefusal(`Not finished yet. ${releaseNote(release)}`) : waitingRefusal(deps, input, { jobId, holds });
}

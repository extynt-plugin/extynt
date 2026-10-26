// The authoring line of the running chat turn (how much the model has queued and whether the queue is sealed) and the turn-state text the model reads at each step.
import { boolean, decodeOrThrow, fallback, type Infer, type JsonObject, number } from "@extynt/decode";
import { planOperationCount } from "@extynt/mcp-server";

import { lenientObject } from "./server-mcp-arguments.js";
import type { SidecarState } from "./server-state.js";
import type { ChatAuthoringProgress } from "./server-types.js";

type AuthoringState = Pick<SidecarState, "chatAuthoring" | "chatProgress" | "now" | "openQueuePlanId" | "plans" | "statusMemory">;

interface AuthoringCall {
  readonly requestId: string;
  readonly tool: string;
  readonly data: JsonObject | undefined;
  readonly queuePlanId: string | null | undefined;
}

const QUEUE_TOOLS: ReadonlySet<string> = new Set(["ae_queue_add", "ae_queue_finish"]);

const queueTelemetry = lenientObject({
  queued: fallback(number(), undefined),
  operationCount: fallback(number(), undefined),
  accepted: fallback(number(), undefined),
  sealed: fallback(boolean(), undefined),
});

type QueueTelemetry = Infer<typeof queueTelemetry>;

interface QueueProgress {
  readonly planId: string;
  readonly operations: number;
  readonly batches: number;
  readonly sealed: boolean;
}

function count(reported: number | undefined, fallback: number): number {
  return reported === undefined ? fallback : Math.max(0, Math.floor(reported));
}

function plural(amount: number, noun: string): string {
  return `${amount} ${noun}${amount === 1 ? "" : "s"}`;
}

interface QueueStep {
  readonly telemetry: QueueTelemetry;
  readonly sealed: boolean;
  readonly before: number;
  readonly batchesBefore: number;
  readonly held: number | undefined;
}

function stepOf(call: AuthoringCall, previous: ChatAuthoringProgress | undefined, held: number | undefined): QueueStep {
  const telemetry = decodeOrThrow(queueTelemetry, call.data ?? {});
  return { telemetry, sealed: call.tool === "ae_queue_finish" && telemetry.sealed === true, before: previous?.operations ?? 0, batchesBefore: previous?.batches ?? 0, held };
}

function operationsOf(step: QueueStep): number {
  const queued = count(step.telemetry.queued, step.held ?? step.before);
  return step.sealed ? count(step.telemetry.operationCount, step.before) : queued;
}

function batchesOf(step: QueueStep): number {
  const queued = count(step.telemetry.queued, step.held ?? step.before);
  const staged = count(step.telemetry.accepted, 0) > 0 || queued > step.before;
  return step.batchesBefore + (step.sealed || !staged ? 0 : 1);
}

function authoringLabel(progress: QueueProgress): string {
  const operations = plural(progress.operations, "operation");
  return progress.sealed ? `Sealed ${operations}, queued to apply` : `Authoring ${operations} in ${plural(progress.batches, "call")}`;
}

function previousAuthoring(state: AuthoringState, requestId: string): ChatAuthoringProgress | undefined {
  return state.chatAuthoring?.requestId === requestId ? state.chatAuthoring.progress : undefined;
}

function progressOf(state: AuthoringState, call: AuthoringCall, previous: ChatAuthoringProgress | undefined, held: number | undefined): QueueProgress | undefined {
  const planId = call.queuePlanId ?? state.openQueuePlanId ?? "";
  if (!planId) return undefined;
  const step = stepOf(call, previous, held);
  return { planId, operations: operationsOf(step), batches: batchesOf(step), sealed: step.sealed };
}

function heldPlanOf(state: AuthoringState, call: AuthoringCall): ReturnType<AuthoringState["plans"]["get"]> {
  const planId = typeof call.queuePlanId === "string" ? call.queuePlanId : state.openQueuePlanId;
  return planId ? state.plans.get(planId) : undefined;
}

function publish(state: AuthoringState, requestId: string, authoring: ChatAuthoringProgress): void {
  state.chatAuthoring = { requestId, progress: authoring };
  const polled = state.chatProgress.get(requestId);
  if (polled) polled.authoring = authoring;
}

/** Records the authoring line a queue tool call moved: operations queued, calls made and whether the queue is sealed. The polled progress copies it at once, because a seal ends the cycle and the copy taken before the call would read as still open. */
export function recordAuthoringProgress(state: AuthoringState, call: AuthoringCall): void {
  if (!QUEUE_TOOLS.has(call.tool)) return;
  const previous = previousAuthoring(state, call.requestId), held = heldPlanOf(state, call);
  const progress = progressOf(state, call, previous, held ? planOperationCount(held) : undefined);
  if (!progress) return;
  publish(state, call.requestId, { ...progress, jobId: held?.jobId ?? previous?.jobId ?? null, label: authoringLabel(progress), at: state.now().toISOString() });
}

/** The status line remembered for a request, started empty when the request is a new one. */
export function statusMemoryFor(state: Pick<SidecarState, "statusMemory">, requestId: string): { value: string | null } {
  if (!state.statusMemory || state.statusMemory.requestId !== requestId) state.statusMemory = { requestId, value: null };
  return state.statusMemory;
}

/** The sidecar's own account of the turn, trusted by the model: what is queued and that the job has no time limit; no clock is shown, since a countdown makes models stop a build early. */
export function runningTurnState(state: Pick<SidecarState, "chatAuthoring">, requestId: string): string {
  const authoring = state.chatAuthoring?.requestId === requestId ? state.chatAuthoring.progress : undefined;
  const queue = authoring
    ? `queue: ${authoring.operations} operation(s) accepted in ${authoring.batches} batch(es), ${authoring.sealed ? "sealed and applying" : "still open — seal it with ae_queue_finish as soon as it is whole, then open the next one for the rest"}`
    : "queue: empty. Nothing has been queued this turn yet — if the job needs a composition, a layer or a setting changed, queue that now with ae_queue_add instead of reading further";
  return `Turn state (the sidecar's own; trusted):\n${queue}\nturn: there is no time limit on this job; it continues across cycles until the whole request is built, so take the steps the work needs and do not stop early.`;
}

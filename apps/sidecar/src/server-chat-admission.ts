// Admission of one chat turn: turns are admitted one at a time, a new message replaces the running turn, and a workflow job that still holds the engine turns the message away.
import type { ServerResponse } from "node:http";

import type { PlanLogCapability } from "./server-plan-log.js";
import { translatorOf } from "./ui-language.js";
import { refuse, type RefusalAnswer } from "./server-route-table.js";
import type { SidecarState } from "./server-state.js";
import { AUTHORING_MS_CEILING, boundedElapsedMs } from "./server-durations.js";
import { CHAT_SUPERSEDE_SETTLE_MS } from "./server-limits.js";
import type { WorkflowCyclesCapability } from "./server-workflow-cycles.js";

/** A running chat turn. `clientGone` is set when the panel's request closed before the turn finished; `detachable` when the turn runs the workflow engine, so a closed panel does not abort it. */
export interface ChatTurn {
  readonly requestId: string;
  jobId?: string;
  clientGone?: boolean;
  detachable?: boolean;
  readonly controller: AbortController;
  readonly startedAt: number;
  readonly settled: Promise<void>;
}

/** An admitted turn with the call that records that it has settled. */
export interface ActiveChatTurn {
  readonly turn: ChatTurn;
  readonly markSettled: () => void;
}

type Admission = { readonly kind: "admitted"; readonly active: ActiveChatTurn } | RefusalAnswer;

type AdmissionState = Pick<SidecarState, "activeChatTurn" | "chatProgress" | "workflowContinuationQueue" | "workflowCoordinator" | "workflowSchedulerRunning" | "hostFacts" | "now" | "options">;

interface AdmissionDeps {
  readonly state: AdmissionState;
  readonly dispatch: Pick<PlanLogCapability, "logPlanEvent"> & Pick<WorkflowCyclesCapability, "cancelWorkflowJob">;
}

interface Latch {
  readonly promise: Promise<void>;
  readonly release: () => void;
}

const admissionTails = new WeakMap<AdmissionState, Promise<void>>();

function latch(): Latch {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

async function enterAdmissionQueue(state: AdmissionState): Promise<() => void> {
  const prior = admissionTails.get(state) ?? Promise.resolve();
  const next = latch();
  admissionTails.set(state, next.promise);
  await prior;
  return next.release;
}

function settlesWithin(settled: Promise<void>, allowanceMs: number): Promise<boolean> {
  let giveUp: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => { giveUp = setTimeout(() => resolve(false), allowanceMs); });
  return Promise.race([settled.then(() => true), timeout]).finally(() => clearTimeout(giveUp));
}

async function supersedeRunningTurn(deps: AdmissionDeps, requestId: string): Promise<void> {
  const previous = deps.state.activeChatTurn;
  if (!previous) return;
  deps.dispatch.logPlanEvent("turn.superseded", { requestId: previous.requestId, by: requestId, ranMs: boundedElapsedMs(previous.startedAt, AUTHORING_MS_CEILING) ?? 0 });
  previous.controller.abort(new Error(`superseded by ${requestId}`));
  if (await settlesWithin(previous.settled, CHAT_SUPERSEDE_SETTLE_MS)) return;
  deps.dispatch.logPlanEvent("turn.supersede-timeout", { requestId: previous.requestId, by: requestId, waitedMs: CHAT_SUPERSEDE_SETTLE_MS });
}

function abandonStaleApprovalJob(deps: AdmissionDeps): void {
  const { state } = deps;
  if (state.activeChatTurn || state.workflowSchedulerRunning || state.workflowContinuationQueue.size > 0) return;
  const jobId = state.workflowCoordinator.staleApprovalJobId();
  if (jobId === null) return;
  deps.dispatch.cancelWorkflowJob(jobId);
  deps.dispatch.logPlanEvent("workflow.stale-approval-abandoned", { jobId });
}

function workflowEngineBusy(state: AdmissionState): boolean {
  return state.workflowCoordinator.workflowStore.getState().activeJobId !== null || state.workflowSchedulerRunning || state.workflowContinuationQueue.size > 0;
}

function turnOwnsJob(state: AdmissionState, turn: ChatTurn): boolean {
  const coordinator = state.workflowCoordinator;
  const job = coordinator.workflowStore.getState().jobs[turn.jobId ?? coordinator.jobIdForSeed(turn.requestId)];
  return !!job && job.status !== "completed" && job.status !== "cancelled";
}

function leaveWhenPanelCloses(deps: AdmissionDeps, turn: ChatTurn, response: ServerResponse): void {
  if (response.writableFinished) return;
  turn.clientGone = true;
  if (!turn.detachable && !turnOwnsJob(deps.state, turn)) {
    turn.controller.abort(new Error("the panel closed this request"));
    return;
  }
  const jobId = turn.jobId ?? deps.state.workflowCoordinator.jobIdForSeed(turn.requestId);
  deps.dispatch.logPlanEvent("chat.client-detached", { requestId: turn.requestId, jobId, step: deps.state.chatProgress.get(turn.requestId)?.step ?? 0 });
}

function openTurn(deps: AdmissionDeps, requestId: string, response: ServerResponse): ActiveChatTurn {
  const settled = latch();
  const turn: ChatTurn = { requestId, controller: new AbortController(), startedAt: Date.now(), settled: settled.promise };
  response.on("close", () => leaveWhenPanelCloses(deps, turn, response));
  deps.state.activeChatTurn = turn;
  return { turn, markSettled: settled.release };
}

/**
 * Admits a message as the running turn, one admission at a time. A message replaces the running turn: that turn is
 * aborted and given a bounded time to settle and release its workflow job. A job whose only pending work is a batch
 * waiting for a panel approval has no live way to progress, because its approval is one-time and short-lived and the
 * new message means the user moved on, so it is abandoned (cancelling its plan card) instead of blocking the message.
 * A job still held by a live turn, scheduler or continuation refuses the message with WORKFLOW_ENGINE_BUSY. Once
 * admitted, a closed panel stops a turn that has no workflow job; a turn that runs the workflow engine detaches and
 * runs on until it completes, is stopped or hits a limit, and the panel reattaches through the activity stream.
 */
export async function admitChatTurn(deps: AdmissionDeps, requestId: string, response: ServerResponse): Promise<Admission> {
  const observedTurn = deps.state.activeChatTurn;
  const release = await enterAdmissionQueue(deps.state);
  try {
    if (deps.state.activeChatTurn !== observedTurn) return refuse(409, "CHAT_ADMISSION_SUPERSEDED", translatorOf(deps.state)("failure.chat.superseded"));
    await supersedeRunningTurn(deps, requestId);
    abandonStaleApprovalJob(deps);
    if (workflowEngineBusy(deps.state)) return refuse(409, "WORKFLOW_ENGINE_BUSY", translatorOf(deps.state)("failure.chat.engineBusy"));
    return { kind: "admitted", active: openTurn(deps, requestId, response) };
  } finally {
    release();
  }
}

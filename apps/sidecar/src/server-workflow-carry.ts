// The request a workflow carries across the question it asked the user: saved when the job is cancelled to ask, restored into the job the reply opens.
import type { Translate } from "@extynt/ui-text";
import type { WorkflowId } from "@extynt/workflow";
import type { SidecarState } from "./server-state.js";
import type { WorkflowOrchestrationBundle, WorkflowSpecialistRole, WorkflowSpecialistSession } from "./workflow-orchestration.js";

/** A design handoff and goal saved before cancelling a job that asked the user. */
export interface CarriedRequest {
  goal: string;
  question: string;
  kind: "question" | "design-brief";
  bundle?: WorkflowOrchestrationBundle;
  sessions?: Map<WorkflowSpecialistRole, WorkflowSpecialistSession>;
  savedAt: number;
}

/** Time a carried request is valid before it expires. */
export const CARRIED_REQUEST_TTL_MS = 60 * 60 * 1000;

type CarryState = Pick<SidecarState, "carriedRequests" | "persistWorkflowHandoffs" | "workflowOrchestrations" | "workflowSpecialistSessions" | "workflowCoordinator">;

interface AskedQuestion {
  readonly jobId: WorkflowId;
  readonly asked: { readonly question: string; readonly kind: CarriedRequest["kind"] };
  readonly now: number;
  readonly sessionId?: string | undefined;
}

const NO_SESSION = "";

function sessionKey(sessionId: string | undefined): string {
  return sessionId ?? NO_SESSION;
}

/** Whether this chat has a question waiting for its answer; another chat's question never counts. */
export function hasCarriedRequest(state: Pick<SidecarState, "carriedRequests">, sessionId: string | undefined): boolean {
  return state.carriedRequests.has(sessionKey(sessionId));
}

function takeIdleSessions(state: CarryState, jobId: WorkflowId): Map<WorkflowSpecialistRole, WorkflowSpecialistSession> {
  const taken = new Map<WorkflowSpecialistRole, WorkflowSpecialistSession>();
  const sessions = state.workflowSpecialistSessions.get(jobId);
  for (const [role, session] of sessions ?? []) {
    if (session.pending) continue;
    taken.set(role, session);
    sessions?.delete(role);
  }
  return taken;
}

/** Saves the asked request, its design bundle and its idle specialist sessions before the job is cancelled. */
export function carryAskedRequest(state: CarryState, { jobId, asked, now, sessionId }: AskedQuestion): void {
  const goal = state.workflowCoordinator.workflowStore.getState().jobs[jobId]?.goalSummary ?? "";
  const sessions = takeIdleSessions(state, jobId);
  const bundle = state.workflowOrchestrations.get(jobId);
  state.workflowOrchestrations.delete(jobId);
  state.carriedRequests.set(sessionKey(sessionId), {
    goal,
    question: asked.question,
    kind: asked.kind,
    ...(bundle ? { bundle } : {}),
    ...(sessions.size > 0 ? { sessions } : {}),
    savedAt: now,
  });
  state.persistWorkflowHandoffs();
}

/** Returns and clears this chat's carried request if still valid; other chats' requests are left alone. */
export function takeCarriedRequest(state: Pick<SidecarState, "carriedRequests">, taker: { readonly now: number; readonly sessionId?: string | undefined }): CarriedRequest | undefined {
  const { now, sessionId } = taker;
  const carried = state.carriedRequests.get(sessionKey(sessionId));
  state.carriedRequests.delete(sessionKey(sessionId));
  if (!carried || now - carried.savedAt > CARRIED_REQUEST_TTL_MS) return undefined;
  return carried;
}

/** The goal that combines the original request with the user's answer. */
export function answeredGoal(carried: CarriedRequest, reply: string): string {
  return `${carried.goal}\n\nThe agent asked the user: ${carried.question.slice(0, 800)}\nThe user answered: ${reply.slice(0, 800)}`;
}

const ANSWERED_GOAL = /^([\s\S]*?)\n\nThe agent asked the user: [\s\S]*?\nThe user answered: ([\s\S]*)$/;

/** The goal as the panel's header shows it: an answered goal reads "request · your answer: reply" in the panel's language (the agent's own question stays in the model's text), any other goal as it is. */
export function shownGoal(goal: string, say: Translate): string {
  const parts = ANSWERED_GOAL.exec(goal);
  return parts?.[1] === undefined || parts[2] === undefined ? goal : say("status.sheet.answered", { goal: parts[1], reply: parts[2] });
}

/** Restores the carried design bundle and specialist sessions to the job the reply opened. */
export function adoptCarriedDesign(state: Pick<SidecarState, "persistWorkflowHandoffs" | "workflowOrchestrations" | "workflowSpecialistSessions">, jobId: WorkflowId, carried: CarriedRequest): void {
  if (carried.bundle) state.workflowOrchestrations.set(jobId, carried.bundle);
  if (carried.sessions && carried.sessions.size > 0) state.workflowSpecialistSessions.set(jobId, new Map(carried.sessions));
  state.persistWorkflowHandoffs();
}

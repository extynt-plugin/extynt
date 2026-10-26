// Wake messages for a loop that ends in prose: a missing feature, a placed layer outside its frame, or open checklist items are answered inside the same cycle.
import type { FinalAnswerRoom } from "./agent-types.js";
import { coverageMessage } from "./request-coverage.js";
import { jobCoverageRefusal, jobCovered } from "./server-workflow-auto-complete.js";
import { frameRefusal } from "./server-workflow-frame-gate.js";
import { filmRefusal } from "./server-workflow-film-gate.js";
import { ownerTurn, settledJob } from "./server-workflow-finish-turn.js";
import type { ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import { openItemsNudge } from "./server-workflow-checklist.js";
import { specialistWake } from "./server-workflow-specialists.js";

interface WakeDeps { readonly state: Pick<ChatAgentDeps["state"], "workflowCoordinator" | "plans">; readonly planState: Pick<ChatAgentDeps["planState"], "normalizedLatest"> }

const WAKE_STEPS = 3;
const MAX_FRAME_WAKES = 2;
const frameWakes = new Map<string, number>();

/**
 * A model that ends in prose while the request still names features the project does not show is woken inside the same
 * loop, where its layers, ids and operation schemas are still in context (and in the provider's prompt cache), instead
 * of ending the cycle and paying a continuation that re-reads all of it. The refusal goes through the same per-job
 * ledger completion uses, so wakes and completion refusals together stay bounded by its no-progress limit.
 */
export function coverageWake(deps: WakeDeps, input: ChatAgentInput, room: FinalAnswerRoom): string | undefined {
  if (!ownerTurn(input) || input.workflowObservationOnly) return undefined;
  if (room.stepsLeft <= room.wrapUp + WAKE_STEPS) return undefined;
  const jobId = deps.state.workflowCoordinator.jobIdForSeed(input.workflowJobId);
  if (!settledJob(deps, jobId)) return undefined;
  const missing = jobCoverageRefusal(deps, jobId);
  if (!missing) return frameWake(deps, jobId);
  return `[Sidecar wake event: ${coverageMessage(missing)} The layers and ids from this turn are still valid, so do not re-inspect or re-describe what you already used. Queue what is missing in one bounded batch with ae_queue_add, seal it with ae_queue_finish, then continue from its receipt (and call ae_workflow_complete once everything is built).]`;
}

function frameWake(deps: WakeDeps, jobId: string): string | undefined {
  const offFrame = frameRefusal(deps, jobId) ?? filmRefusal(deps, jobId);
  if (!offFrame || (frameWakes.get(jobId) ?? 0) >= MAX_FRAME_WAKES) return undefined;
  frameWakes.set(jobId, (frameWakes.get(jobId) ?? 0) + 1);
  return `[Sidecar wake event: ${offFrame.message} The layers and ids from this turn are still valid, so do not re-inspect them. Queue the correction in one bounded batch with ae_queue_add, seal it with ae_queue_finish, then continue from its receipt (and call ae_workflow_complete once everything is built).]`;
}

const MAX_PROSE_NUDGES = 2;
const MAX_TRACKED_REQUESTS = 200;
const proseNudges = new Map<string, { count: number; stepsLeft: number }>();

function dropOldestNudge(): void {
  const [oldest] = proseNudges.keys();
  if (oldest !== undefined) proseNudges.delete(oldest);
}

function nudgeCount(requestId: string, room: FinalAnswerRoom): number {
  const last = proseNudges.get(requestId);
  return last && last.stepsLeft === room.stepsLeft + 1 ? last.count : 0;
}

function recordNudge(requestId: string, count: number, room: FinalAnswerRoom): void {
  proseNudges.delete(requestId);
  proseNudges.set(requestId, { count: count + 1, stepsLeft: room.stepsLeft });
  if (proseNudges.size > MAX_TRACKED_REQUESTS) dropOldestNudge();
}

function checklistWake(deps: WakeDeps & { state: Pick<ChatAgentDeps["state"], "workflowSidecarActions" | "options"> }, input: ChatAgentInput, room: FinalAnswerRoom): string | undefined {
  if (!ownerTurn(input) || input.workflowObservationOnly || room.stepsLeft <= room.wrapUp + WAKE_STEPS) return undefined;
  const jobId = deps.state.workflowCoordinator.jobIdForSeed(input.workflowJobId);
  if (!settledJob(deps, jobId)) return undefined;
  const nudge = openItemsNudge(deps.state, jobId, deps.state.workflowCoordinator.workflowStore.getState());
  const count = nudgeCount(input.requestId, room);
  if (!nudge || count >= MAX_PROSE_NUDGES) return undefined;
  recordNudge(input.requestId, count, room);
  return `[Sidecar wake event: ${nudge}]`;
}

function finishedJob(deps: WakeDeps, input: ChatAgentInput): boolean {
  if (!ownerTurn(input) || input.workflowObservationOnly) return false;
  const jobId = deps.state.workflowCoordinator.jobIdForSeed(input.workflowJobId);
  return settledJob(deps, jobId) && jobCovered(deps, jobId) && !frameRefusal(deps, jobId) && !filmRefusal(deps, jobId);
}

/**
 * What the loop is told when the model ends in prose: a specialist handoff it has not read comes first, then a missing feature.
 * A finished job is not woken at all: the turn ends and completes from its receipts, and a handoff the owner built without has nothing left to add.
 */
export async function finalAnswerWake(deps: ChatAgentDeps, input: ChatAgentInput, room: FinalAnswerRoom): Promise<string | undefined> {
  if (finishedJob(deps, input)) return checklistWake(deps, input, room);
  return await specialistWake(deps, input) ?? coverageWake(deps, input, room) ?? checklistWake(deps, input, room);
}

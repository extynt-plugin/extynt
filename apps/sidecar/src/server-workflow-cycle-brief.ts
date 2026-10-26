// The text a workflow cycle is briefed with: the goal, the notes the sidecar owes the model, and the instruction that fits what the cycle is for.
import type { WorkflowContinuationInput, WorkflowContinuationOperationEvidence } from "@extynt/workflow";
import type { AgentRunResult } from "./agent.js";
import { WORKFLOW_OWNER, type WorkflowOrchestrationBundle } from "./workflow-orchestration.js";
import { coverageMessage, takePendingCoverage } from "./request-coverage.js";
import { stalledCycles, STALL_FEEDBACK_CYCLES, STALL_CYCLES } from "./server-workflow-cycle-budget.js";
import { checklistProgress } from "./server-workflow-checklist.js";
import { drainSidecarActions, sidecarActionsText } from "./server-workflow-sidecar-actions.js";
import type { CycleRun, WorkflowCyclesDeps, WorkflowTurn } from "./server-workflow-cycle-state.js";

/**
 * What one cycle's brief is built from: the turn, the job's seed and goal, the user's logged messages (`request`, re-read by every
 * later cycle in place of the goal summary), the continuation brief, the coverage refusal that sent the cycle, the `notes` the model
 * is owed (why the last cycle did not finish the job, and how long the job has gone without landing work) and, in free run, the
 * reason the sidecar decided this cycle is a read-only `recheck`.
 */
export type WorkflowCycleTurnInput = {
  turn: WorkflowTurn;
  seed: string;
  cycle: number;
  goal: string;
  request?: string | undefined;
  continuation: WorkflowContinuationInput | null;
  orchestration: WorkflowOrchestrationBundle | undefined;
  admissionRefusal: AgentRunResult["workflowAdmissionRefusal"] | undefined;
  coverage?: readonly string[] | undefined;
  notes?: string | undefined;
  recheck?: string | undefined;
};

/** The turn a workflow cycle runs: the user's turn plus the workflow fields the agent loop reads. */
export type WorkflowCycleRequest = WorkflowTurn & { stopAfterSeal: true; workflowJobId: string; workflowGoalSummary: string; workflowContinuation: WorkflowContinuationInput | null; workflowCycle: number; workflowRole: typeof WORKFLOW_OWNER; workflowObservationOnly?: boolean; workflowOrchestration?: WorkflowOrchestrationBundle };

type Admission = AgentRunResult["workflowAdmissionRefusal"];

type MessageParts = {
  readonly head: string;
  readonly notes: string | undefined;
  readonly stopped: string;
  readonly coverage: readonly string[] | undefined;
  readonly repairInstruction: string | undefined;
  readonly rejectionInstruction: string;
};

function operationLine(operation: WorkflowContinuationOperationEvidence): string {
  const target = operation.readback?.targetLayerId ? ` on layer ${operation.readback.targetLayerId}` : "";
  const expected = operation.readback?.expected !== undefined ? `; expected ${operation.readback.expected}` : "";
  const observed = operation.readback?.observed !== undefined ? `; observed ${operation.readback.observed}` : "";
  return `${operation.type}${target}${expected}${observed}`;
}

function failedReadbackBatch(continuation: WorkflowContinuationInput | null): WorkflowContinuationInput["settledBatches"][number] | undefined {
  const latest = continuation?.settledBatches.at(-1);
  return latest?.execution === "executed" && latest.mutation === "applied" && latest.verification === "failed" ? latest : undefined;
}

function readbackRepairInstruction(continuation: WorkflowContinuationInput | null): string | undefined {
  const latest = failedReadbackBatch(continuation);
  const mismatches = latest?.receipt?.outcomes.filter((operation) => operation.outcome === "readback_mismatch").map(operationLine) ?? [];
  if (!latest || !mismatches.length) return undefined;
  return `After Effects applied batch ${latest.batchId}, but these operations did not read back as requested: ${mismatches.join(", ")}. Refresh the snapshot, inspect those target layers, and queue only fresh corrections for the mismatches. Do not replay the applied batch or any operation that may already have mutated.`;
}

function observationOnlyContinuation(continuation: WorkflowContinuationInput | null, coverage: readonly string[] | undefined): boolean {
  if (coverage) return false;
  const latest = continuation?.settledBatches.at(-1);
  return continuation?.stageStatus === "active" && latest?.execution === "executed" && latest.verification === "applied_unverified" && latest.verificationCoverage.visual === false;
}

function cyclePurpose(parts: MessageParts): string {
  if (parts.coverage) return "This is a build cycle: queue the missing features named above in one bounded batch (it is not an observation pass).\n\n";
  if (parts.repairInstruction || parts.rejectionInstruction) return "This is a repair cycle: queue the bounded correction described above (it is not an observation pass).\n\n";
  return "";
}

function stopFeedbackText(turn: WorkflowTurn, cycle: number): string {
  const feedback = turn.stopFeedback;
  if (!feedback || feedback.cycle !== cycle) return "";
  if (feedback.direct) return `${feedback.message}\n\n`;
  return `Your previous cycle was stopped by the sidecar: ${feedback.message}\nNothing about that stop ends the job. Fix its cause (re-read the project if it changed) and keep building, and call ae_workflow_complete once every part of the request is built and verified.\n\n`;
}

function rejectionInstructionFor(admissionRefusal: Admission): string {
  if (!admissionRefusal) return "";
  return `The sidecar rejected sealed plan ${admissionRefusal.planId} before admission with exact code ${admissionRefusal.code}: ${admissionRefusal.message} No host mutation occurred. Refresh and use the fresh project context supplied in this cycle; author a new bounded correction and do not replay that refused plan.`;
}

function headWithNotes(head: string, notes: string | undefined): string {
  return `${head}\n\n${notes ? `${notes}\n\n` : ""}`;
}

function buildCycleMessage(parts: MessageParts): string {
  const coverage = parts.coverage ? `Completion was refused. ${coverageMessage(parts.coverage)}\n\n` : "";
  const rejection = parts.rejectionInstruction ? `${parts.rejectionInstruction}\n\n` : "";
  const repair = parts.repairInstruction ? `${parts.repairInstruction}\n\n` : "";
  return `${headWithNotes(parts.head, parts.notes)}${parts.stopped}${coverage}${rejection}${repair}${cyclePurpose(parts)}Continue this workflow only from the structured receipt evidence in the sidecar brief. A settled rejection that proves no mutation is a repair request: inspect its per-operation outcomes, recall sourcePlanId when present, and author a fresh bounded correction against the supplied current snapshot. Never replay an operation marked applied or possibly mutated. If the goal is not complete, propose one bounded next batch. If the evidence proves the goal is complete, call ae_workflow_complete with no arguments (the sidecar cites its own receipts and takes the frames it needs, so do not capture or observe frames just to complete); a prose answer is not completion authority.`;
}

function recheckMessage(parts: MessageParts, recheck: string): string {
  return `${headWithNotes(parts.head, parts.notes)}${parts.stopped}The sidecar is rechecking the project before you build on it: ${recheck}. This is a read-only observation cycle: run one bounded capture/observation pass of the current project and judge it. Do not replay or correct mutations in this cycle; the next cycle builds again, from what you saw.`;
}

function observationMessage(parts: MessageParts): string {
  return `${headWithNotes(parts.head, parts.notes)}The prior stage executed but still needs independent visual evidence. Run one bounded read-only capture/observation pass. Do not replay or correct mutations in this cycle.`;
}

type Brief = { readonly message: string; readonly observationOnly: boolean };

function continuationBrief(input: WorkflowCycleTurnInput): Brief {
  const { turn, cycle, goal, request, continuation, admissionRefusal, coverage, notes, recheck } = input;
  const repairInstruction = readbackRepairInstruction(continuation);
  const rejectionInstruction = rejectionInstructionFor(admissionRefusal);
  const parts = { head: request ?? goal, notes, stopped: stopFeedbackText(turn, cycle), coverage, repairInstruction, rejectionInstruction };
  const rechecking = recheck !== undefined && !coverage && !repairInstruction && !rejectionInstruction;
  const observationOnly = rechecking || observationOnlyContinuation(continuation, coverage);
  if (rechecking) return { message: recheckMessage(parts, recheck), observationOnly };
  return { message: observationOnly ? observationMessage(parts) : buildCycleMessage(parts), observationOnly };
}

/** Builds the turn one cycle runs: the first cycle is the user's message plus notes, later cycles are a brief of the goal and the evidence; a read-only pass is marked. */
export function workflowCycleInput(input: WorkflowCycleTurnInput): WorkflowCycleRequest {
  const { turn, seed, cycle, goal, continuation, orchestration, notes } = input;
  const brief = continuationBrief(input);
  const first = cycle === 0;
  return {
    ...turn,
    message: first ? (notes ? `${turn.message}\n\n${notes}` : turn.message) : brief.message,
    history: first ? turn.history : [],
    stopAfterSeal: true,
    workflowJobId: seed,
    workflowGoalSummary: goal,
    workflowContinuation: continuation,
    workflowCycle: cycle,
    workflowRole: WORKFLOW_OWNER,
    ...(brief.observationOnly ? { workflowObservationOnly: true } : {}),
    ...(orchestration ? { workflowOrchestration: orchestration } : {}),
  };
}

/** A continuation cycle carries the coverage refusal that sent it; the first cycle has none to carry. */
export function cycleCoverage(run: CycleRun, cycle: number): string[] | undefined {
  return cycle > 0 ? takePendingCoverage(run.state.jobId) : undefined;
}

function recentRefusals(run: CycleRun): string[] {
  const { continuation, admissionRefusal } = run.state;
  const blockers = (continuation?.blockers ?? []).filter((blocker) => blocker.startsWith("provider:")).map((blocker) => blocker.slice("provider:".length));
  const admission = admissionRefusal ? [`${admissionRefusal.code}: ${admissionRefusal.message}`] : [];
  return [...blockers, ...admission].slice(-3);
}

function stallNote(stalled: number, refusals: readonly string[]): string {
  const latest = refusals.length ? ` Latest refusals and stops:\n${refusals.map((line) => `- ${line}`).join("\n")}` : "";
  return `${stalled} cycles have passed with nothing applied in After Effects; extynt pauses the job at ${STALL_CYCLES}. Change approach: build the next missing part as one bounded batch, or call ae_workflow_complete if everything is built and verified.${latest}`;
}

function takeFeedbackFor(run: CycleRun, cycle: number): string[] {
  const feedback = run.state.feedback;
  if (feedback?.cycle !== cycle) return [];
  run.dispatch({ kind: "feedback-taken" });
  return [feedback.message];
}

/** What the model is told at this cycle, told once: why the last one did not finish the job, from STALL_FEEDBACK_CYCLES on that nothing has landed and what was refused, the sidecar's own actions, and the checklist. */
export function cycleNotes(deps: WorkflowCyclesDeps, run: CycleRun, cycle: number): string | undefined {
  const jobId = run.state.jobId;
  const notes = takeFeedbackFor(run, cycle);
  const stalled = stalledCycles(deps.state, jobId, cycle);
  if (stalled >= STALL_FEEDBACK_CYCLES) notes.push(stallNote(stalled, recentRefusals(run)));
  const done = sidecarActionsText(drainSidecarActions(deps.state, jobId ?? undefined));
  if (done) notes.push(done);
  const status = checklistProgress(deps.state, jobId ?? undefined, deps.state.workflowCoordinator.workflowStore.getState());
  if (status) notes.push(status);
  return notes.length ? notes.join("\n\n") : undefined;
}

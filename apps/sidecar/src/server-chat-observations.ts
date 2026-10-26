// Records the visual evidence a frame observation gives a workflow job, and the temporal evidence two such frames at different times give together.
import { createHash } from "node:crypto";
import { decode } from "@extynt/decode";
import { frameSummary, framesDiffer, type MeasuredFrame } from "./server-chat-frame-summary.js";
import { replyPayload } from "./server-chat-agent-reply.js";
import type { AgentToolSuccess, ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import type { SidecarState } from "./server-state.js";
import { WORKFLOW_OWNER } from "./workflow-orchestration.js";

type WorkflowCoordinator = NonNullable<SidecarState["workflowCoordinator"]>;
type WorkflowState = ReturnType<WorkflowCoordinator["workflowStore"]["getState"]>;
type RecordedObservation = WorkflowState["observations"][string];
type Capture = NonNullable<ReturnType<ChatAgentDeps["state"]["captures"]["get"]>>;

interface ObservationTarget {
  readonly coordinator: WorkflowCoordinator;
  readonly workflow: WorkflowState;
  readonly jobId: string;
  readonly stageId: string | undefined;
}

function observationId(jobId: string, captureId: string, fingerprint: string): string {
  return `wf-observation-${createHash("sha256").update(`${jobId}:${captureId}:${fingerprint}`).digest("hex").slice(0, 32)}`;
}

function currentStage(workflow: WorkflowState, jobId: string): string | undefined {
  const job = workflow.jobs[jobId];
  if (!job) return undefined;
  return [...job.stageIds].reverse().find((candidate) => {
    const status = workflow.stages[candidate]?.status;
    return status === "active" || status === "open";
  });
}

function observationTarget(deps: ChatAgentDeps, input: ChatAgentInput): ObservationTarget | undefined {
  const coordinator = deps.state.workflowCoordinator;
  if (!input.workflowJobId || input.workflowRole !== WORKFLOW_OWNER) return undefined;
  const jobId = coordinator.jobIdForSeed(input.workflowJobId);
  const workflow = coordinator.workflowStore.getState();
  if (!workflow.jobs[jobId]) return undefined;
  return { coordinator, workflow, jobId, stageId: currentStage(workflow, jobId) };
}

function completedObservation(reply: AgentToolSuccess): ReturnType<typeof replyPayload> {
  const payload = replyPayload(reply);
  if (payload?.status !== "completed") return undefined;
  const summary = payload.summary;
  return summary === undefined || summary === null ? undefined : payload;
}

function stageField(target: ObservationTarget): { stageId?: string } {
  return target.stageId ? { stageId: target.stageId } : {};
}

function temporalPriors(target: ObservationTarget, capture: Capture, captureId: string, fingerprint: string): RecordedObservation[] {
  return Object.values(target.workflow.observations).filter((candidate) => candidate.jobId === target.jobId && candidate.kind === "visual" && candidate.observedFingerprint === fingerprint && candidate.captureId && candidate.captureId !== captureId && candidate.compositionId === capture.request.compositionId && candidate.time !== undefined && candidate.time !== capture.request.time);
}

function summaryOf(capture: Capture | undefined): MeasuredFrame {
  const decoded = decode(frameSummary, capture?.receipt?.summary);
  return decoded.ok ? decoded.value : undefined;
}

interface TemporalObservation {
  readonly deps: ChatAgentDeps;
  readonly target: ObservationTarget;
  readonly captureId: string;
  readonly capture: Capture | undefined;
  readonly fingerprint: string;
  readonly payload: NonNullable<ReturnType<typeof replyPayload>>;
}

function recordTemporalObservation({ deps, target, captureId, capture, fingerprint, payload }: TemporalObservation): void {
  if (!capture) return;
  const current = summaryOf(capture);
  const prior = temporalPriors(target, capture, captureId, fingerprint).find((candidate) => framesDiffer(summaryOf(candidate.captureId ? deps.state.captures.get(candidate.captureId) : undefined), current));
  if (!prior) return;
  const temporalId = observationId(target.jobId, `${captureId}:temporal`, fingerprint);
  if (!target.workflow.observations[temporalId]) {
    target.coordinator.recordObservation(target.jobId, { evidenceId: temporalId, jobId: target.jobId, ...stageField(target), kind: "temporal", basis: `Two completed local frame measurements of ${capture.request.compositionId} at times ${prior.time} and ${capture.request.time} showed a material measured frame change.`, observedFingerprint: fingerprint, captureId, compositionId: capture.request.compositionId, time: capture.request.time, recordedAt: deps.state.now().toISOString() });
  }
  Object.assign(payload, { temporalEvidence: { kind: "observation", evidenceId: temporalId, evidenceKind: "temporal", observedFingerprint: fingerprint } });
}

function closeStageIfSettled(target: ObservationTarget): void {
  try {
    target.coordinator.completeStageForContinuation(target.jobId);
  } catch {
    return;
  }
}

/** Records a completed frame observation as visual evidence of the job, and closes the stage held open for its frame check, so the job can go on and complete; a stage still short of evidence stays open. It is temporal evidence too when two completed local measurements of the same composition at the same project, at different times, show a material measured frame change; a single still, or identical stills, stays visual-only. Earlier frames of the same composition at the same project pair with this one whatever their stage, since a frame check closes its stage and the next frame then belongs to none. The evidence ids ride in the reply the model reads. */
export function recordVisualObservation(deps: ChatAgentDeps, input: ChatAgentInput, captureId: string | undefined, reply: AgentToolSuccess): void {
  const target = observationTarget(deps, input);
  const payload = completedObservation(reply);
  const fingerprint = reply.snapshotFingerprint;
  if (!target || !payload || captureId === undefined || !fingerprint) return;
  const evidenceId = observationId(target.jobId, captureId, fingerprint);
  const capture = deps.state.captures.get(captureId);
  if (!target.workflow.observations[evidenceId]) {
    target.coordinator.recordObservation(target.jobId, { evidenceId, jobId: target.jobId, ...stageField(target), kind: "visual", basis: "A completed local rendered-frame capture was sampled and exposed to the orchestrator/validator.", observedFingerprint: fingerprint, ...(capture ? { captureId, compositionId: capture.request.compositionId, time: capture.request.time } : {}), recordedAt: deps.state.now().toISOString() });
  }
  closeStageIfSettled(target);
  Object.assign(payload, { workflowEvidence: { kind: "observation", evidenceId, evidenceKind: "visual", observedFingerprint: fingerprint } });
  recordTemporalObservation({ deps, target, captureId, capture, fingerprint, payload });
}

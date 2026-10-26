// The frame gate: a job that placed a layer outside its frame is not complete until the layer is moved back in or removed.
import { adviseFrameQuality, latestFrameImage } from "./decision-frame.js";
import type { WorkflowBatch, WorkflowId } from "@extynt/workflow";
import type { PlanStateCapability } from "./server-plan-state.js";
import type { SidecarState } from "./server-state.js";
import { boundedFrameChecks, standingFindings, type FrameCheckRow } from "./verify/frame-check.js";

/** The code completion is refused with while a placed layer stands outside its frame. */
export const LAYER_OFF_FRAME = "LAYER_OFF_FRAME";

type LatestSnapshot = NonNullable<ReturnType<PlanStateCapability["normalizedLatest"]>>;

interface FrameGateDeps {
  readonly state: Pick<SidecarState, "workflowCoordinator" | "plans">;
  readonly planState: Pick<PlanStateCapability, "normalizedLatest">;
}

const MAX_SENTENCES = 6;

function batchStands(batch: WorkflowBatch): boolean {
  return batch.recovery.state !== "undone" && batch.recovery.state !== "undo_unverified";
}

function batchFrameRows(deps: FrameGateDeps, batch: WorkflowBatch | undefined): FrameCheckRow[] {
  const planId = batch && batchStands(batch) ? batch.admission?.sourcePlanId : undefined;
  return (planId ? boundedFrameChecks(deps.state.plans.get(planId)?.receipt?.frameChecks) : undefined) ?? [];
}

function jobFrameRows(deps: FrameGateDeps, jobId: WorkflowId): FrameCheckRow[] {
  const state = deps.state.workflowCoordinator.workflowStore.getState();
  return (state.jobs[jobId]?.batchIds ?? []).flatMap((batchId) => batchFrameRows(deps, state.batches[batchId]));
}

function stillDrawn(latest: LatestSnapshot, row: FrameCheckRow): boolean {
  const layer = latest.compositions.find((composition) => composition.id === row.compositionId)?.layers.find((candidate) => candidate.id === row.layerId);
  return !!layer && layer.enabled !== false;
}

/** The layers among rows (in order) that stand outside their frame at the project: only the settled samples of the last check of each layer count, so a layer that slides in or out is not held. */
export function standingFrameFindings(latest: LatestSnapshot, rowsInOrder: readonly FrameCheckRow[]): FrameCheckRow[] {
  return standingFindings(rowsInOrder).filter((row) => stillDrawn(latest, row));
}

/** The sentence that names a standing finding. */
export function frameFindingSentence(row: FrameCheckRow): string {
  return row.message ?? `${row.layer} is ${row.verdict === "OFF_FRAME" ? "outside" : "mostly outside"} its frame.`;
}

/** What completion is refused with while a placed layer stands outside its frame; null when none does. */
export function frameRefusal(deps: FrameGateDeps, jobId: WorkflowId): { code: typeof LAYER_OFF_FRAME; message: string } | null {
  const latest = deps.planState.normalizedLatest();
  const findings = latest ? standingFrameFindings(latest, jobFrameRows(deps, jobId)) : [];
  if (findings.length === 0) return null;
  const sentences = findings.slice(0, MAX_SENTENCES).map(frameFindingSentence).join(" ");
  return { code: LAYER_OFF_FRAME, message: `${sentences} Move ${findings.length === 1 ? "it" : "them"} into the frame with one bounded batch (set Position, or its Position expression), then call ae_workflow_complete again.` };
}

/** Asks the decision models how well the job's sampled frames show its request; the answer only adds a note to the completion. */
export async function primeFrameAdvice(deps: FrameGateDeps & { readonly state: Pick<SidecarState, "decisions" | "captures"> }, jobId: WorkflowId): Promise<void> {
  const latest = deps.planState.normalizedLatest(), job = deps.state.workflowCoordinator.workflowStore.getState().jobs[jobId];
  const rows = jobFrameRows(deps, jobId);
  const composition = latest?.compositions.find((candidate) => candidate.id === rows[0]?.compositionId);
  if (!job || !composition) return;
  const image = latestFrameImage(deps.state.captures, composition.id);
  await adviseFrameQuality(deps.state.decisions, { jobId, frame: { request: job.goalSummary, width: composition.width, height: composition.height }, rows: rows.filter((row) => row.compositionId === composition.id), ...(image === undefined ? {} : { image }) });
}

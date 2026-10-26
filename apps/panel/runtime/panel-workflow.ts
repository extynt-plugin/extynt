/**
 * Read-only workflow projection for the diagnostics drawer.
 *
 * This module deliberately renders facts only. It never claims a recovery action, submits a mailbox command, or turns
 * resumeSupported into dispatch.
 */
import { byId } from "./panel-dom.js";
import { observeWorkflowPause } from "./panel-waiting.js";
import { diagnosticId, every, send, transportContext, type TransportError } from "./panel-transport.js";
import { workflowStatusDecoder, type WorkflowProjection, type WorkflowResume } from "./workflow-status.js";
import { onLanguageChange, t } from "./panel-language.js";

const POLL_MS = 10000;
const STATUS_PATH = "/v1/workflow/status";

let polling = false;
let inFlight = false;

function set(id: string, text: string): void {
  const node = byId(id);
  if (node) node.textContent = text;
}

function unknownWords(): string { return t("status.workflow.unknown"); }
function recoveryUnknown(): string { return t("status.workflow.unknownCap"); }
function reviewConnection(): string { return t("status.workflow.reviewConnection"); }

function jobLine(projection: WorkflowProjection): string {
  const active = projection.jobs.find((job) => job.jobId === projection.activeJobId);
  if (active) return (active.status || unknownWords()) + " · " + (active.jobId || t("status.workflow.activeJob"));
  if (projection.jobs.length === 0) return t("status.workflow.noJobs");
  return t("status.workflow.jobsNoneActive", { count: projection.jobs.length });
}

function batchLine(projection: WorkflowProjection): string {
  const active = projection.batches.find(
    (batch) => (projection.activeJobId === null || batch.jobId === projection.activeJobId) && batch.lifecycle !== "settled" && batch.lifecycle !== "cancelled",
  );
  if (active) return t("status.workflow.batch", { lifecycle: active.lifecycle || unknownWords(), execution: active.execution || unknownWords(), verification: active.verification || unknownWords() });
  if (projection.batches.length === 0) return t("status.workflow.noBatches");
  return t("status.workflow.batchesNoDispatch", { count: projection.batches.length });
}

function evidenceLine(projection: WorkflowProjection): string {
  const latest = projection.batches.slice().reverse().find((batch) => projection.activeJobId === null || batch.jobId === projection.activeJobId);
  if (!latest) return t("status.workflow.noEvidence");
  return t("status.workflow.evidence", { verification: latest.verification || unknownWords(), mutation: latest.mutation || unknownWords() });
}

function blockerLine(projection: WorkflowProjection): string {
  const blocker = projection.jobs.find((job) => job.jobId === projection.activeJobId)?.blocker;
  if (blocker) return blocker;
  const failure = projection.providerFailures.at(-1);
  if (failure) {
    const code = failure.code || t("status.workflow.providerFailure");
    return failure.afterSeal ? t("status.workflow.afterSeal", { code: code }) : code;
  }
  return projection.divergences.length > 0 ? t("status.workflow.divergence") : t("status.workflow.noneReported");
}

function appliedLine(resume: WorkflowResume | null): string {
  const applied = resume?.applied;
  if (!applied) return recoveryUnknown();
  return t("status.workflow.applied", { settled: applied.settledBatches, count: applied.totalBatches, verified: applied.verifiedBatches, unverified: applied.appliedUnverifiedBatches });
}

function remainingLine(resume: WorkflowResume | null): string {
  const remaining = resume?.remaining;
  return remaining ? t("status.workflow.remaining", { criteria: remaining.criteria, count: remaining.batches }) : recoveryUnknown();
}

function continuationLine(resume: WorkflowResume | null): string {
  if (!resume) return t("status.workflow.statusUnavailable");
  if (resume.needsInput) return resume.whyPaused ? t("status.workflow.needsInputWhy", { reason: resume.whyPaused }) : t("status.workflow.needsInput");
  if (resume.automatic) return resume.autoApply ? t("status.workflow.autoApply") : t("status.workflow.approvalNeeded");
  if (resume.status === "running") return t("status.workflow.running");
  return resume.whyPaused || t("status.workflow.noPause");
}

function summaryLine(projection: WorkflowProjection): string {
  if (!projection.resumeSupported) return t("status.workflow.noRecoveryEngine");
  return projection.automaticDispatchResumeSupported ? t("status.workflow.recoveryAvailable") : t("status.workflow.durableAvailable");
}

function recoveryLine(projection: WorkflowProjection, resume: WorkflowResume | null): string {
  if (!projection.resumeSupported) return t("status.workflow.unavailableNoRecovery");
  return resume ? continuationLine(resume) : t("status.workflow.inspectionOnly");
}

function renderProjection(projection: WorkflowProjection, resume: WorkflowResume | null): void {
  set("workflow-engine", "workflow-v1");
  set("workflow-status-summary", summaryLine(projection));
  set("workflow-recovery", recoveryLine(projection, resume));
  set("workflow-applied", appliedLine(resume));
  set("workflow-remaining", remainingLine(resume));
  set("workflow-pause", resume?.needsInput ? resume.whyPaused || t("status.workflow.inputRequired") : t("status.workflow.none"));
  set("workflow-job", jobLine(projection));
  set("workflow-batch", batchLine(projection));
  set("workflow-evidence", evidenceLine(projection));
  set("workflow-blocker", blockerLine(projection));
}

function renderUnavailable(message: string): void {
  set("workflow-engine", t("status.workflow.unavailableMode"));
  set("workflow-status-summary", message);
  set("workflow-recovery", t("status.workflow.unavailableRecovery"));
  set("workflow-applied", recoveryUnknown());
  set("workflow-remaining", recoveryUnknown());
  set("workflow-pause", reviewConnection());
  set("workflow-job", recoveryUnknown());
  set("workflow-batch", recoveryUnknown());
  set("workflow-evidence", recoveryUnknown());
  set("workflow-blocker", reviewConnection());
}

function failureMessage(error: TransportError): string {
  if (error.status === 404) return t("status.workflow.noStatusRoute");
  return error.message || t("status.workflow.readFailed");
}

/** Reads the engine's status once and draws it; a read already in flight is not repeated. */
export function refreshWorkflowStatus(): void {
  if (inFlight) return;
  inFlight = true;
  const context = transportContext("GET", STATUS_PATH, diagnosticId("workflow-status"));
  send({ method: "GET", path: STATUS_PATH, body: null, context, decoder: workflowStatusDecoder }, (reply) => {
    inFlight = false;
    if (!reply.ok) {
      renderUnavailable(failureMessage(reply.error));
      return;
    }
    const status = reply.value;
    if (!status?.projection) {
      renderUnavailable(t("status.workflow.noProjection"));
      return;
    }
    renderProjection(status.projection, status.resume);
    observeWorkflowPause(status.pause);
  });
}

/** Starts the ten-second refresh of the workflow status, and draws it again in the new language on a language change. */
export function wireWorkflowStatus(): void {
  if (polling) return;
  polling = true;
  onLanguageChange(refreshWorkflowStatus);
  every(refreshWorkflowStatus, POLL_MS);
}

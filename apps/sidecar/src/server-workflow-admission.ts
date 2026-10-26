// Admission authority and the ready-plan queue: what the sidecar tells the workflow engine about a sealed plan, how a sealed plan reaches the panel's commit queue, and the wait for its receipt.
import { collectOperationProblems } from "@extynt/action-plan";
import { hostVerificationKey } from "@extynt/capability-catalogue";
import { decode, fallback, type Infer, number, object, optional, string } from "@extynt/decode";
import type { StoredPlan } from "@extynt/mcp-server";
import { sealedPlanAutoApplies } from "./host/auto-approve.js";
import { jobCreatedIds } from "./host/job-created-ids.js";
import type { ToolFields } from "./server-mcp-result.js";
import type { HttpCoreCapability } from "./server-http-core.js";
import type { PlanLogCapability } from "./server-plan-log.js";
import type { PlanStateCapability } from "./server-plan-state.js";
import type { PlanViewCapability } from "./server-plan-view.js";
import { AUTHORING_MS_CEILING, boundedElapsedMs } from "./server-durations.js";
import { readyPlanFinished } from "./server-limits.js";
import type { SidecarState } from "./server-state.js";
import { hashId } from "./workflow-coordinator-types.js";
import type { WorkflowCoordinator } from "./workflow-coordinator.js";

/** What a sealed plan's result carries to the sidecar and gets back: the apply outcome, the wait verdict and the receipt the model reads. */
export interface SealedData {
  planId?: string;
  operationCount?: number;
  undoGroups?: number;
  job?: { id?: string; batches?: number };
  apply?: ReturnType<PlanViewCapability["workOutcome"]>;
  pipeline?: ReturnType<PlanViewCapability["pipeline"]>;
  waitedSeconds?: number;
  note?: string;
  receipt?: ToolFields;
}

interface ReadyPlanTurn { readonly requestId: string | null; readonly autoApply: boolean }

interface ReadyPlanAnswer {
  queued: boolean;
  waiting: number;
  limit: number;
  planId: string;
  action?: string;
  refusal?: { code: string; message: string };
  autoApply?: boolean;
}

/** The sealed-plan queue and the receipt wait the chat agent uses. */
export interface WorkflowAdmissionCapability {
  awaitSealedApply(data: SealedData, planId: string, seconds: number, signal?: AbortSignal): Promise<void>;
  jobBatchOf(jobId: string, planId: string): number | null;
  queueReadyPlan(data: SealedData | undefined, turn?: ReadyPlanTurn, workflowJobId?: string, workflowGoalSummary?: string): ReadyPlanAnswer;
  workflowAuthority(record: StoredPlan): Parameters<WorkflowCoordinator["admitPlan"]>[1]["authority"];
}

interface WorkflowAdmissionDeps {
  readonly state: Pick<SidecarState, "chatSettleWaitMs" | "hostFacts" | "hostProfile" | "latest" | "now" | "options" | "panel" | "plans" | "readyPlanQueueLimit" | "readyPlanSequence" | "readyPlans" | "workflowCoordinator">;
  readonly planState: Pick<PlanStateCapability, "normalizedLatest">;
  readonly planView: Pick<PlanViewCapability, "pipeline" | "workOutcome">;
  readonly planLog: Pick<PlanLogCapability, "logPlanEvent">;
  readonly transport: Pick<HttpCoreCapability, "notifyChange" | "waitUntil">;
}

type Verification = NonNullable<StoredPlan["presentation"]>["verification"];
type Authority = Parameters<WorkflowCoordinator["admitPlan"]>[1]["authority"];
type ReadyEntry = WorkflowAdmissionDeps["state"]["readyPlans"][number];
interface AuthorityFacts { profile: WorkflowAdmissionDeps["state"]["hostProfile"]; hostKey: string | null; verification: Verification | undefined; exactVerification: boolean; matchingSnapshot: ReturnType<WorkflowAdmissionDeps["planState"]["normalizedLatest"]>; targetProblems: ReturnType<typeof collectOperationProblems>; targetResolved: boolean | undefined }
interface Identity { readonly jobId: string | undefined; readonly jobBatch: number | null }
interface QueuedAnnouncement { readonly planId: string; readonly turn: ReadyPlanTurn; readonly limit: number; readonly operations: number; readonly jobId: string | null }
interface WorkflowGate { readonly record: StoredPlan | undefined; readonly planId: string; readonly jobId: string | undefined; readonly workflowJobId: string | undefined; readonly workflowGoalSummary: string | undefined }
interface WaitSettlement { readonly planId: string; readonly waitedMs: number; readonly current: StoredPlan | undefined; readonly gone: boolean }

const MAX_TARGET_CODES = 3;
const sealedFacts = object({
  planId: optional(fallback(string(), undefined)),
  operationCount: optional(fallback(number(), undefined)),
  undoGroups: optional(fallback(number(), undefined)),
  job: optional(fallback(object({ id: optional(fallback(string(), undefined)), batches: optional(fallback(number(), undefined)) }), undefined)),
});
const pipelinePanel = object({ panel: string() });

function factsOf(data: SealedData | undefined): Infer<typeof sealedFacts> | undefined {
  const decoded = decode(sealedFacts, data);
  return decoded.ok ? decoded.value : undefined;
}

function reportedOperations(data: SealedData | undefined): number {
  return factsOf(data)?.operationCount ?? 0;
}

function reportedUndoGroups(data: SealedData | undefined): number {
  return factsOf(data)?.undoGroups ?? 1;
}

function readyPlanIdentity(data: SealedData | undefined, record: StoredPlan | undefined): Identity {
  const job = factsOf(data)?.job;
  const batches = job?.batches;
  return { jobId: job?.id ?? record?.jobId, jobBatch: typeof batches === "number" && Number.isFinite(batches) ? Math.max(1, Math.floor(batches)) : null };
}

function completeVerification(verification: Verification | undefined, reported: number, expected: number): boolean {
  return !!verification && typeof verification.hostKey === "string" && verification.hostKey.length > 0 && verification.requiresAcknowledgement === false && reported === expected && (verification.operations ?? []).every((entry) => entry.status === "verified" || entry.status === "unverified");
}

function targetFacts(deps: WorkflowAdmissionDeps, record: StoredPlan): Pick<AuthorityFacts, "matchingSnapshot" | "targetProblems" | "targetResolved"> {
  const snapshot = deps.planState.normalizedLatest();
  const matchingSnapshot = snapshot && snapshot.fingerprint === record.plan.snapshotFingerprint ? snapshot : undefined;
  if (!matchingSnapshot) return { matchingSnapshot, targetProblems: [], targetResolved: undefined };
  const targetProblems = collectOperationProblems(record.plan, matchingSnapshot);
  return { matchingSnapshot, targetProblems, targetResolved: targetProblems.length === 0 };
}

function authorityFacts(deps: WorkflowAdmissionDeps, record: StoredPlan): AuthorityFacts {
  const runtime = deps.state.latest?.snapshot.result.runtime;
  const verification = record.presentation?.verification;
  return {
    profile: deps.state.hostProfile,
    hostKey: runtime ? hostVerificationKey(runtime) : null,
    verification,
    exactVerification: completeVerification(verification, (verification?.operations ?? []).length, record.plan.operations.length),
    ...targetFacts(deps, record),
  };
}

function authorityHostBasis(facts: AuthorityFacts): string {
  if (facts.profile) return `host profile ${facts.profile.profileId} phase=${facts.profile.phase} completeness=${facts.profile.inventoryCompleteness ?? (facts.profile.inventoryTruncated ? "truncated" : "complete")}`;
  return facts.hostKey ? `runtime evidence ${facts.hostKey}` : "no host profile was available; host capability remains probationary";
}

function authorityTargetBasis(record: StoredPlan, facts: AuthorityFacts): string {
  if (facts.targetResolved === true) return `sealed plan target resolver accepted all ${record.plan.operations.length} typed operation targets against snapshot ${record.plan.snapshotFingerprint}`;
  if (facts.matchingSnapshot) return `target resolver rejected one or more sealed operation targets: ${facts.targetProblems.slice(0, MAX_TARGET_CODES).map((problem) => problem.code).join(", ")}`;
  return "no matching snapshot was available; target resolution is unknown";
}

function workflowAuthority(deps: WorkflowAdmissionDeps, record: StoredPlan): Authority {
  const facts = authorityFacts(deps, record);
  return {
    hostProfileId: facts.profile?.profileId ?? null,
    hostBasis: authorityHostBasis(facts),
    hostSupported: !!facts.profile && facts.profile.phase === "complete" && facts.profile.inventoryTruncated === false,
    verificationBasis: facts.verification && facts.exactVerification ? `host verification contract ${facts.verification.hostKey} reports every sealed operation verified` : "no complete host verifier contract covers every sealed operation; verification remains partial",
    exactVerification: facts.exactVerification,
    schemaBasis: `sealed plan ${record.plan.planId} passed typed operation validation against snapshot ${record.plan.snapshotFingerprint}`,
    ...(facts.targetResolved === undefined ? {} : { targetResolved: facts.targetResolved }),
    targetBasis: authorityTargetBasis(record, facts),
    mutationBasis: `typed mutation classification for ${record.plan.operations.length} sealed operations`,
    recoveryBasis: `undoability audit of ${record.plan.operations.length} sealed operations`,
  };
}

function jobBatchOf(deps: WorkflowAdmissionDeps, jobId: string, planId: string): number | null {
  let ordinal = 0, seen = 0;
  for (const record of deps.state.plans.values()) {
    if (record.jobId !== jobId) continue;
    seen += 1;
    if (record.plan.planId === planId) ordinal = seen;
  }
  return ordinal || null;
}

function ownedIdsFor(state: Pick<SidecarState, "plans" | "workflowCoordinator">, jobId: string | undefined): ReadonlySet<string> {
  if (!jobId) return new Set();
  return new Set([...jobCreatedIds(state, hashId("wf-job", jobId)), ...jobCreatedIds(state, jobId)]);
}

function readyPlanRefusal(deps: WorkflowAdmissionDeps, answer: { readonly planId: string; readonly limit: number; readonly action: string; readonly refusal?: { code: string; message: string } }): ReadyPlanAnswer {
  const { planId, limit, action, refusal } = answer;
  return { queued: false, waiting: deps.state.readyPlans.length, limit, planId, action, ...(refusal ? { refusal } : {}) };
}

function queueFullAction(deps: WorkflowAdmissionDeps, planId: string): string {
  return `Plan ${planId} is sealed and can still be applied, but it was not queued for the panel's commit flow: ${deps.state.readyPlans.length} sealed batches are already waiting to be committed this turn. The plan store still holds it (ae_list_plans and ae_approve_plan address it by id), so nothing was lost — but stop authoring further batches, and either commit or discard the waiting ones (or answer the user and let the queue clear with the turn), before sealing more.`;
}

function readyPlanEntry(deps: WorkflowAdmissionDeps, queued: { readonly planId: string; readonly data: SealedData | undefined; readonly identity: Identity; readonly turn: ReadyPlanTurn }): ReadyEntry {
  const { planId, data, identity, turn } = queued;
  const jobBatch = identity.jobBatch ?? (identity.jobId ? jobBatchOf(deps, identity.jobId, planId) : null);
  return { planId, batch: (deps.state.readyPlanSequence += 1), jobId: identity.jobId ?? null, jobBatch, operations: reportedOperations(data), undoGroups: reportedUndoGroups(data), completedAt: deps.state.now().toISOString(), deliveredAt: null, requestId: turn.requestId, autoApply: turn.autoApply && sealedPlanAutoApplies(deps.state, planId) };
}

function refuseWorkflow(deps: WorkflowAdmissionDeps, planId: string, refusal: { code: string; message: string }): { code: string; message: string } {
  deps.planLog.logPlanEvent("plan.workflow-refused", { planId, code: refusal.code, message: refusal.message });
  return refusal;
}

function queueIntoWorkflow(deps: WorkflowAdmissionDeps, planId: string): { code: string; message: string } | undefined {
  try {
    deps.state.workflowCoordinator.queue(planId);
    return undefined;
  } catch (error) {
    return refuseWorkflow(deps, planId, { code: "WORKFLOW_QUEUE_REFUSED", message: error instanceof Error ? error.message : String(error) });
  }
}

function admitReadyWorkflow(deps: WorkflowAdmissionDeps, gate: WorkflowGate, data: SealedData | undefined): { code: string; message: string } | undefined {
  const { record, planId } = gate;
  if (!record) return undefined;
  const owner = gate.workflowJobId ?? gate.jobId;
  const admitted = deps.state.workflowCoordinator.admitPlan(record.plan, { ...(owner === undefined ? {} : { jobId: owner }), ...(gate.workflowGoalSummary === undefined ? {} : { goalSummary: gate.workflowGoalSummary }), undoGroups: reportedUndoGroups(data), authority: workflowAuthority(deps, record), ownedIds: ownedIdsFor(deps.state, owner) });
  if (!admitted.ok) return refuseWorkflow(deps, planId, { code: admitted.code, message: admitted.message });
  return queueIntoWorkflow(deps, planId);
}

function announceQueued(deps: WorkflowAdmissionDeps, queued: QueuedAnnouncement): boolean {
  const autoApply = deps.state.readyPlans.at(-1)?.autoApply === true;
  deps.planLog.logPlanEvent("plan.queued", { planId: queued.planId, requestId: queued.turn.requestId, waiting: deps.state.readyPlans.length, limit: queued.limit, operations: queued.operations, jobId: queued.jobId, autoApply });
  if (!autoApply) deps.state.hostFacts.capturePlan?.(queued.planId, "before", "idle");
  deps.transport.notifyChange();
  return autoApply;
}

function pruneFinishedReadyPlans(deps: WorkflowAdmissionDeps): void {
  for (let index = deps.state.readyPlans.length - 1; index >= 0; index -= 1) {
    const entry = deps.state.readyPlans[index];
    if (entry && readyPlanFinished(deps.state.plans.get(entry.planId))) deps.state.readyPlans.splice(index, 1);
  }
}

function queueReadyPlan(deps: WorkflowAdmissionDeps, data: SealedData | undefined, turn: ReadyPlanTurn, workflow: { readonly workflowJobId?: string; readonly workflowGoalSummary?: string }): ReadyPlanAnswer {
  const planId = factsOf(data)?.planId ?? "";
  const limit = deps.state.readyPlanQueueLimit;
  if (!planId || deps.state.readyPlans.some((entry) => entry.planId === planId)) return { queued: true, waiting: deps.state.readyPlans.length, limit, planId };
  pruneFinishedReadyPlans(deps);
  if (deps.state.readyPlans.length >= limit) {
    deps.planLog.logPlanEvent("plan.queue-refused", { planId, waiting: deps.state.readyPlans.length, limit });
    return readyPlanRefusal(deps, { planId, limit, action: queueFullAction(deps, planId) });
  }
  const record = deps.state.plans.get(planId);
  const identity = readyPlanIdentity(data, record);
  const failure = admitReadyWorkflow(deps, { record, planId, jobId: identity.jobId, workflowJobId: workflow.workflowJobId, workflowGoalSummary: workflow.workflowGoalSummary }, data);
  if (failure) return readyPlanRefusal(deps, { planId, limit, action: failure.message, refusal: failure });
  deps.state.readyPlans.push(readyPlanEntry(deps, { planId, data, identity, turn }));
  const autoApply = announceQueued(deps, { planId, turn, limit, operations: reportedOperations(data), jobId: identity.jobId ?? null });
  return { queued: true, waiting: deps.state.readyPlans.length, limit, planId, autoApply };
}

function panelState(deps: WorkflowAdmissionDeps): string {
  const decoded = decode(pipelinePanel, deps.planView.pipeline());
  return decoded.ok ? decoded.value.panel : "";
}

function settleSealedApplyWait(deps: WorkflowAdmissionDeps, data: SealedData, settlement: WaitSettlement): void {
  const { planId, waitedMs, current, gone } = settlement;
  deps.planLog.logPlanEvent("plan.apply-timeout", { planId, waitedMs, status: current?.status ?? null, panelGone: gone });
  Object.assign(data, {
    waitedSeconds: Math.round(waitedMs / 100) / 10,
    note: gone
      ? "Nothing has been applied yet: no panel is polling this turn. The plan is sealed and queued, and ae_status reports the outcome once a panel picks it up."
      : "This plan is sealed and queued, and the panel has not reported back yet, so its apply is still running or was never picked up. ae_status reports the outcome when the receipt lands.",
    pipeline: deps.planView.pipeline(),
  });
}

async function awaitSealedApply(deps: WorkflowAdmissionDeps, data: SealedData, wait: { readonly planId: string; readonly seconds: number; readonly signal?: AbortSignal }): Promise<void> {
  const { planId, seconds, signal } = wait;
  const record = deps.state.plans.get(planId);
  if (!record) return;
  data.apply = deps.planView.workOutcome(record);
  if (seconds <= 0) return;
  const startedAt = Date.now();
  deps.planLog.logPlanEvent("plan.apply-wait", { planId, seconds });
  await deps.transport.waitUntil(() => !!deps.state.plans.get(planId)?.receipt || panelState(deps) === "offline", seconds, signal);
  const waitedMs = boundedElapsedMs(startedAt, AUTHORING_MS_CEILING) ?? 0;
  deps.state.chatSettleWaitMs += waitedMs;
  const current = deps.state.plans.get(planId);
  if (current) data.apply = deps.planView.workOutcome(current);
  if (current?.receipt) deps.planLog.logPlanEvent("plan.apply-observed", { planId, waitedMs, status: current.status });
  else settleSealedApplyWait(deps, data, { planId, waitedMs, current, gone: panelState(deps) === "offline" });
}

/** Builds the admission capability: the authority facts the engine admits a sealed plan on, the commit queue that hands the plan to the panel, and the wait for its receipt. */
export function createWorkflowAdmission(deps: WorkflowAdmissionDeps): WorkflowAdmissionCapability {
  return {
    awaitSealedApply: (data, planId, seconds, signal) => awaitSealedApply(deps, data, { planId, seconds, ...(signal ? { signal } : {}) }),
    jobBatchOf: (jobId, planId) => jobBatchOf(deps, jobId, planId),
    queueReadyPlan: (data, turn = { requestId: null, autoApply: false }, workflowJobId, workflowGoalSummary) => queueReadyPlan(deps, data, turn, { ...(workflowJobId === undefined ? {} : { workflowJobId }), ...(workflowGoalSummary === undefined ? {} : { workflowGoalSummary }) }),
    workflowAuthority: (record) => workflowAuthority(deps, record),
  };
}

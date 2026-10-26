// Turns a sealed plan into the events that admit it as one workflow batch: policy facts, authority evidence and the sealed digest.

import { PLAN_UNDO_BATCH_SIZE } from "@extynt/host-ae";
import {
  computeWorkflowBatchDigest, analyzeWorkflowBatch, WORKFLOW_BATCH_BUDGET,
  classifyWorkflowPolicy as classifyAdmissionPolicy,
  type WorkflowAdmissionDimensions, type WorkflowAuthorityEvidence, type WorkflowEvent, type WorkflowPostconditionContract, type WorkflowJob, type WorkflowState, type WorkflowStage, type WorkflowId
} from "@extynt/workflow";
import { ownedRemovalIndexes, undoabilityOfOperation } from "@extynt/mcp-server";
import { collectOperationProblems, computePlanDigest, type ActionPlan } from "@extynt/action-plan";
import { completionFailure, type CompletionFailure } from "./workflow-coordinator-completion.js";
import { WORKFLOW_JOB_CONSTRAINTS, WORKFLOW_OPERATION_LIMIT, eventId, hashId, operationIdFor, workflowGoalText, type WorkflowAdmissionAuthority, type WorkflowPlanRecord } from "./workflow-coordinator-types.js";
import { successCriteriaForGoal } from "./workflow-goal-evidence.js";

type MutationState = WorkflowAdmissionDimensions["mutationBehavior"]["state"];
type DimensionName = keyof WorkflowAdmissionDimensions;
type AuthorityEvidenceMap = Readonly<Record<DimensionName, WorkflowAuthorityEvidence>>;
type PlanCondition = NonNullable<ActionPlan["postconditions"]>[number];

/** What the caller knows about the job and the host when it asks for a plan to be admitted. */
export interface WorkflowAdmissionOptions {
  readonly jobId?: string;
  readonly goalSummary?: string;
  readonly undoGroups: number;
  readonly authority: WorkflowAdmissionAuthority;
  readonly ownedIds?: ReadonlySet<string>;
}

type WorkflowPolicyClass = "automatic" | "manual-only" | "probationary" | "blocked";

interface WorkflowPolicyVerdict {
  readonly policyClass: WorkflowPolicyClass;
  readonly approvalRequired: boolean;
  readonly reasons: readonly string[];
}

/** The ids of the batch and job an admission produced, or why it was refused; `staleBlocker` names a provider-failure blocker that could not be cleared. */
export type AdmissionResult =
  | { readonly ok: true; readonly batchId: WorkflowId; readonly jobId: WorkflowId; readonly staleBlocker?: string }
  | CompletionFailure;

interface AdmissionContext {
  readonly plan: ActionPlan;
  readonly options: WorkflowAdmissionOptions;
  readonly state: WorkflowState;
  readonly jobId: WorkflowId;
  readonly stageId: WorkflowId;
  readonly batchId: WorkflowId;
  readonly at: string;
  readonly dependencies: readonly WorkflowId[];
}

const KIND_RULES: ReadonlyArray<readonly [RegExp, MutationState]> = [
  [/render|export|write_file|external/i, "external"],
  [/delete|remove|clear|replace/i, "destructive"],
  [/create|duplicate|precompose|import|add/i, "creating"],
  [/ensure|set|update|animate|move|reorder|apply/i, "ensuring"],
];

const MUTATION_SEVERITY: Readonly<Record<MutationState, number>> = { idempotent: 1, ensuring: 2, creating: 3, destructive: 4, external: 5 };

const AUTHORITY_KINDS: Readonly<Record<DimensionName, WorkflowAuthorityEvidence["kind"]>> = {
  schemaValue: "validator",
  targetDependency: "target_resolver",
  hostCapability: "host_profile",
  verificationCapability: "verifier_contract",
  mutationBehavior: "mutation_classification",
  recovery: "recovery_audit",
  policy: "policy_decision",
};

function operationKind(type: string): MutationState {
  return KIND_RULES.find(([pattern]) => pattern.test(type))?.[1] ?? "idempotent";
}

function joinMutationBehavior(a: MutationState, b: MutationState): MutationState {
  return MUTATION_SEVERITY[b] > MUTATION_SEVERITY[a] ? b : a;
}

/** The highest-risk behavior of the plan; removing what this same job created (proven in `ownedIds` or created earlier in the plan) counts as ensuring. */
export function mutationBehaviorForPlan(plan: ActionPlan, ownedIds?: ReadonlySet<string>): MutationState {
  const owned = ownedRemovalIndexes(plan.operations, ownedIds);
  return plan.operations.reduce<MutationState>((current, operation, index) => joinMutationBehavior(current, owned.has(index) ? "ensuring" : operationKind(String(operation.type))), "idempotent");
}

function recoveryKind(plan: ActionPlan): WorkflowAdmissionDimensions["recovery"]["state"] {
  const values = plan.operations.map((operation) => undoabilityOfOperation(operation));
  if (values.some((value) => value === "not-undoable")) return "not_undoable";
  if (values.some((value) => value === "host-dependent")) return "partially_undoable";
  return "fully_undoable";
}

function admissionFact<State extends string>(state: State, evidenceId: string, basis: string) {
  return { state, evidenceId, basis };
}

function policyFact<State extends string>(state: State, dimension: string) {
  return admissionFact(state, `sidecar-policy:${dimension}`, `sidecar admission fact: ${dimension}`);
}

function automaticEligible(authority: WorkflowAdmissionAuthority, mutation: MutationState, recovery: WorkflowAdmissionDimensions["recovery"]["state"]): boolean {
  const safeMutation = mutation !== "destructive" && mutation !== "external";
  return authority.targetResolved === true && authority.hostSupported && authority.exactVerification && safeMutation && recovery === "fully_undoable";
}

function policyDimensions(plan: ActionPlan, authority: WorkflowAdmissionAuthority, ownedIds?: ReadonlySet<string>): WorkflowAdmissionDimensions {
  const recovery = recoveryKind(plan);
  const mutation = mutationBehaviorForPlan(plan, ownedIds);
  return {
    schemaValue: policyFact("valid", "schema"),
    targetDependency: policyFact(authority.targetResolved === true ? "resolved" : "unknown", "target"),
    hostCapability: policyFact(authority.hostSupported ? "supported" : "probationary", "host"),
    verificationCapability: policyFact(authority.exactVerification ? "exact" : "partial", "verification"),
    mutationBehavior: policyFact(mutation, "mutation"),
    recovery: policyFact(recovery, "recovery"),
    policy: { decision: automaticEligible(authority, mutation, recovery) ? "automatic" : "manual", evidenceId: "sidecar-policy:policy", basis: "sidecar compatibility adapter retains explicit approval binding" },
  };
}

/** Classifies a plan from independently derived facts; an automatic verdict still requires explicit approval because dispatch has no automatic capability. */
export function classifyWorkflowPolicy(plan: ActionPlan, authority: WorkflowAdmissionAuthority, ownedIds?: ReadonlySet<string>): WorkflowPolicyVerdict {
  const verdict = classifyAdmissionPolicy(policyDimensions(plan, authority, ownedIds));
  return verdict.policyClass === "automatic"
    ? { ...verdict, approvalRequired: true, reasons: ["automatic policy is eligible, but this adapter still requires explicit approval"] }
    : verdict;
}

interface PostconditionText { readonly code: string; readonly description: string }

function postconditionText(value: PlanCondition): PostconditionText | undefined {
  if (typeof value === "string") {
    const text = value.trim();
    return text ? { code: text.slice(0, 128), description: text.slice(0, 1000) } : undefined;
  }
  const code = value.code.trim();
  const description = value.description.trim();
  return code && description ? { code: code.slice(0, 128), description: description.slice(0, 1000) } : undefined;
}

function isPostconditionText(value: PostconditionText | undefined): value is PostconditionText {
  return value !== undefined;
}

/** The plan's required postconditions as structural contracts; visual and temporal claims arrive only through recorded observations. */
export function postconditionContractsForPlan(plan: ActionPlan): readonly WorkflowPostconditionContract[] | undefined {
  const conditions = (plan.postconditions ?? []).slice(0, 64).map(postconditionText).filter(isPostconditionText);
  if (!conditions.length) return undefined;
  return conditions.map((condition, index) => ({ postconditionId: hashId("postcondition", `${plan.planId}:${index}:${condition.code}`), kind: "structural", description: condition.description, required: true }));
}

function undoBoundaryFailure(plan: ActionPlan, reportedUndoGroups: number): CompletionFailure | null {
  const expectedUndoGroups = plan.operations.length > PLAN_UNDO_BATCH_SIZE ? Math.ceil(plan.operations.length / PLAN_UNDO_BATCH_SIZE) : 1;
  if (expectedUndoGroups !== 1) return completionFailure("MULTI_UNDO_BATCH", "workflow-v1 admits exactly one workflow Batch per host undo unit; this plan exceeds the authoritative single-undo operation bound.");
  if (reportedUndoGroups !== expectedUndoGroups) return completionFailure("MULTI_UNDO_BATCH", "workflow-v1 refused a plan whose reported undo-group count does not match the authoritative host boundary.");
  return null;
}

function shapeFailure(plan: ActionPlan): CompletionFailure | null {
  const closure = analyzeWorkflowBatch(plan.operations, { ...WORKFLOW_BATCH_BUDGET, maxOperations: PLAN_UNDO_BATCH_SIZE });
  if (!closure.ok) return completionFailure(closure.code, closure.message);
  if (plan.operations.length < 1 || plan.operations.length > WORKFLOW_OPERATION_LIMIT) return completionFailure("OPERATION_BOUND", "workflow-v1 plan operation count is outside its bounded batch contract.");
  const operationProblems = collectOperationProblems(plan);
  if (operationProblems.length) return completionFailure("INVALID_OPERATION", `workflow-v1 refused the sealed plan because its typed operation payload is invalid: ${operationProblems.slice(0, 4).map((problem) => `${problem.index}:${problem.code}`).join(", ")}.`);
  return null;
}

/** The refusal or earlier admission that decides a plan before any event is built, or null when the plan proceeds to admission. */
export function admissionPreflight(plan: ActionPlan, options: WorkflowAdmissionOptions, existing: WorkflowPlanRecord | undefined): AdmissionResult | null {
  if (existing) return { ok: true, batchId: existing.batchId, jobId: existing.jobId };
  const undoFailure = undoBoundaryFailure(plan, options.undoGroups);
  if (undoFailure) return undoFailure;
  if (options.authority.targetResolved !== true) return completionFailure("TARGET_EVIDENCE_UNAVAILABLE", "workflow-v1 requires target resolution against the exact sealed project snapshot; no matching snapshot-bound evidence was available.");
  const policy = classifyWorkflowPolicy(plan, options.authority, options.ownedIds);
  if (policy.policyClass === "blocked") return completionFailure("POLICY_BLOCKED", `workflow-v1 refused the batch before admission: ${policy.reasons.join("; ")}.`);
  return shapeFailure(plan);
}

function activeStageOf(state: WorkflowState, stageIds: readonly WorkflowId[]): WorkflowStage | undefined {
  return stageIds.map((candidate) => state.stages[candidate]).find((candidate): candidate is WorkflowStage => candidate !== undefined && (candidate.status === "active" || candidate.status === "open"));
}

function stageIdFor(state: WorkflowState, jobId: WorkflowId, priorJob: WorkflowJob | undefined): WorkflowId {
  const active = activeStageOf(state, priorJob?.stageIds ?? []);
  return active?.stageId ?? hashId("wf-stage", priorJob ? `${jobId}:${priorJob.stageIds.length}` : jobId);
}

function provesSnapshot(state: WorkflowState, batchId: WorkflowId, snapshotFingerprint: string): boolean {
  const prior = state.batches[batchId];
  return prior?.lifecycle === "settled"
    && prior.verification.state === "verified"
    && (prior.verification.observedFingerprint ?? prior.execution.receipt?.observedFingerprint) === snapshotFingerprint;
}

/** The job, stage, batch and verified predecessor this plan is admitted under; a failed batch is evidence for repair, never a dependency. */
export function admissionIdentity(state: WorkflowState, plan: ActionPlan, options: WorkflowAdmissionOptions, at: string): AdmissionContext {
  const jobId = hashId("wf-job", options.jobId ?? plan.planId);
  const priorJob = state.jobs[jobId];
  const verifiedDependency = [...(priorJob?.batchIds ?? [])].reverse().find((candidate) => provesSnapshot(state, candidate, plan.snapshotFingerprint));
  return { plan, options, state, jobId, stageId: stageIdFor(state, jobId, priorJob), batchId: hashId("wf-batch", plan.planId), at, dependencies: verifiedDependency === undefined ? [] : [verifiedDependency] };
}

function jobOpenedEvents(context: AdmissionContext): WorkflowEvent[] {
  const { plan, options, state, jobId, at } = context;
  if (state.jobs[jobId]) return [];
  const goalSummary = workflowGoalText(options.goalSummary ?? plan.summary);
  return [{ eventId: eventId("job.opened", jobId), at, type: "job.opened", jobId, engineId: "workflow-v1", title: "Workflow job", goalSummary, constraints: WORKFLOW_JOB_CONSTRAINTS, successCriteria: successCriteriaForGoal(goalSummary) }];
}

function stageOpenedEvents(context: AdmissionContext): WorkflowEvent[] {
  const { plan, state, jobId, stageId, at } = context;
  if (state.stages[stageId]) return [];
  return [{ eventId: eventId("stage.opened", stageId), at, type: "stage.opened", jobId, stageId, title: plan.summary.slice(0, 256), purpose: "Execute one sealed in-panel plan as one workflow batch.", successCriteria: [] }];
}

function baseAdmissionEvents(context: AdmissionContext): WorkflowEvent[] {
  const { plan, jobId, stageId, batchId, at, dependencies } = context;
  const proposed: WorkflowEvent = { eventId: eventId("batch.proposed", batchId), at, type: "batch.proposed", jobId, stageId, batchId, summary: plan.summary.slice(0, 1000), dependencies };
  const operations = plan.operations.map((payload, ordinal): WorkflowEvent => ({ eventId: eventId("operation.proposed", `${batchId}:${ordinal}`), at, type: "operation.proposed", jobId, stageId, batchId, ordinal, payload }));
  return [...jobOpenedEvents(context), ...stageOpenedEvents(context), proposed, ...operations];
}

function authorityBasis(context: AdmissionContext): Readonly<Record<DimensionName, string>> {
  const { plan, options } = context;
  return {
    schemaValue: options.authority.schemaBasis ?? `sealed action-plan validator accepted ${plan.planId}`,
    targetDependency: options.authority.targetBasis ?? "no target resolver evidence was supplied",
    hostCapability: options.authority.hostBasis,
    verificationCapability: options.authority.verificationBasis,
    mutationBehavior: options.authority.mutationBasis ?? `typed mutation classification for ${plan.planId}`,
    recovery: options.authority.recoveryBasis ?? `undoability audit for ${plan.planId}`,
    policy: options.authority.policyApprovalId ? "server-issued approval capability bound at admission" : "awaiting explicit panel approval",
  };
}

interface AuthorityRecords {
  readonly evidence: AuthorityEvidenceMap;
  readonly events: readonly WorkflowEvent[];
}

function authorityRecords(context: AdmissionContext): AuthorityRecords {
  const bases = authorityBasis(context);
  const events: WorkflowEvent[] = [];
  const record = (dimension: DimensionName): WorkflowAuthorityEvidence => {
    const evidenceId = `${context.batchId}:authority:${dimension}`;
    const entry: WorkflowAuthorityEvidence = { evidenceId, kind: AUTHORITY_KINDS[dimension], jobId: context.jobId, batchId: context.batchId, snapshotFingerprint: context.plan.snapshotFingerprint, basis: bases[dimension].slice(0, 1000), recordedAt: context.at };
    events.push({ eventId: eventId("authority.recorded", evidenceId), at: context.at, type: "authority.recorded", jobId: context.jobId, evidence: entry });
    return entry;
  };
  const evidence: AuthorityEvidenceMap = {
    schemaValue: record("schemaValue"),
    targetDependency: record("targetDependency"),
    hostCapability: record("hostCapability"),
    verificationCapability: record("verificationCapability"),
    mutationBehavior: record("mutationBehavior"),
    recovery: record("recovery"),
    policy: record("policy"),
  };
  return { evidence, events };
}

function recorded<State extends string>(state: State, evidence: WorkflowAuthorityEvidence) {
  return admissionFact(state, evidence.evidenceId, evidence.basis);
}

function admissionDimensions(context: AdmissionContext, evidence: AuthorityEvidenceMap): WorkflowAdmissionDimensions {
  const { options, plan } = context;
  const { authority } = options;
  return {
    schemaValue: recorded("valid", evidence.schemaValue),
    targetDependency: recorded("resolved", evidence.targetDependency),
    hostCapability: recorded(authority.hostSupported ? "supported" : "probationary", evidence.hostCapability),
    verificationCapability: recorded(authority.exactVerification ? "exact" : "partial", evidence.verificationCapability),
    mutationBehavior: recorded(mutationBehaviorForPlan(plan, options.ownedIds), evidence.mutationBehavior),
    recovery: recorded(recoveryKind(plan), evidence.recovery),
    policy: { decision: "manual", evidenceId: evidence.policy.evidenceId, basis: evidence.policy.basis, ...(authority.policyApprovalId ? { approvalId: authority.policyApprovalId.slice(0, 128) } : {}) },
  };
}

function admittedEvent(context: AdmissionContext, dimensions: WorkflowAdmissionDimensions): WorkflowEvent {
  const { plan, jobId, stageId, batchId, dependencies, at } = context;
  const sourcePlanDigest = computePlanDigest(plan);
  const operations = plan.operations.map((payload, ordinal) => ({ operationId: operationIdFor(batchId, ordinal), ordinal, type: String(payload.type), payload }));
  const postconditions = postconditionContractsForPlan(plan);
  const undoUnitId = `${batchId}:undo`;
  const digest = computeWorkflowBatchDigest({ jobId, stageId, batchId, dependencies, sourcePlanId: plan.planId, snapshotFingerprint: plan.snapshotFingerprint, sourcePlanDigest, undoUnitId, undoUnitCount: 1, dimensions, ...(postconditions ? { postconditions } : {}), operations });
  return { eventId: eventId("batch.admitted", batchId), at, type: "batch.admitted", jobId, stageId, batchId, sourcePlanId: plan.planId, digest, sourcePlanDigest, snapshotFingerprint: plan.snapshotFingerprint, undoUnitId, undoUnitCount: 1, dimensions, ...(postconditions ? { postconditions } : {}) };
}

/** Every event that admits the plan, in the order the store appends them. */
export function admissionEvents(context: AdmissionContext): readonly WorkflowEvent[] {
  const base = baseAdmissionEvents(context);
  const authority = authorityRecords(context);
  return [...base, ...authority.events, admittedEvent(context, admissionDimensions(context, authority.evidence))];
}

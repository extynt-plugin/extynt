// Admission rules: the policy classification of a batch's independent dimensions, the checks an admitted batch must pass and the action-plan validation of its operation payloads.

import { collectOperationProblems } from "@extynt/action-plan";
import type { ActionPlanV2Operation, PlanInput } from "@extynt/action-plan";
import { decode } from "@extynt/decode";
import type { WorkflowAdmissionDimensions, WorkflowAuthorityEvidenceKind } from "./admission-types.js";
import { assert, fail } from "./assertions.js";
import { ADMISSION_DIMENSIONS } from "./event-decoders.js";
import { MAX_WORKFLOW_OPERATIONS_PER_BATCH } from "./limits.js";
import type { WorkflowState } from "./state-types.js";

/** How a batch's facts classify it. */
export type WorkflowPolicyClass = "automatic" | "manual-only" | "probationary" | "blocked";

/** The policy a set of admission facts implies, with the reasons behind a non-automatic class. */
export interface WorkflowPolicyVerdict {
  readonly policyClass: WorkflowPolicyClass;
  readonly approvalRequired: boolean;
  readonly reasons: readonly string[];
}

interface AdmissionAuthorityCheck {
  readonly state: WorkflowState;
  readonly dimensions: WorkflowAdmissionDimensions;
  readonly jobId: string;
  readonly batchId: string;
  readonly snapshotFingerprint: string;
}

const ADMISSION_DIMENSION_KEYS = ["schemaValue", "targetDependency", "hostCapability", "verificationCapability", "mutationBehavior", "recovery", "policy"] as const;

const AUTHORITY_KIND_BY_DIMENSION: Readonly<Record<keyof WorkflowAdmissionDimensions, WorkflowAuthorityEvidenceKind>> = {
  schemaValue: "validator",
  targetDependency: "target_resolver",
  hostCapability: "host_profile",
  verificationCapability: "verifier_contract",
  mutationBehavior: "mutation_classification",
  recovery: "recovery_audit",
  policy: "policy_decision",
};

function validateAutomaticAdmission(facts: WorkflowAdmissionDimensions): void {
  assert(facts.hostCapability.state === "supported", "INVALID_EVENT", "Automatic admission requires a supported host.");
  assert(facts.verificationCapability.state === "exact", "INVALID_EVENT", "Automatic admission requires exact verification.");
  const mutation = facts.mutationBehavior.state;
  assert(mutation !== "destructive" && mutation !== "external", "INVALID_EVENT", "Destructive/external work requires manual policy.");
  assert(facts.recovery.state === "fully_undoable", "INVALID_EVENT", "Automatic admission requires full recovery.");
}

function validateFactCombinations(facts: WorkflowAdmissionDimensions): void {
  assert(facts.schemaValue.state === "valid", "INVALID_EVENT", "Schema/value evidence is not valid.");
  assert(facts.targetDependency.state === "resolved", "DEPENDENCY_BLOCKED", "Target/dependency evidence is not resolved.");
  const host = facts.hostCapability.state;
  assert(host === "supported" || host === "probationary", "INVALID_EVENT", "Host capability is unavailable or regressed.");
  assert(facts.verificationCapability.state !== "intrinsically_unobservable" || facts.policy.decision === "manual", "INVALID_EVENT", "Intrinsically unobservable work requires manual approval.");
  assert(facts.recovery.state !== "not_undoable", "INVALID_UNDO_UNIT", "A non-undoable batch cannot be admitted as one workflow undo unit.");
}

function validatePolicyAdmission(policy: WorkflowAdmissionDimensions["policy"], facts: WorkflowAdmissionDimensions): void {
  if (policy.decision === "automatic") validateAutomaticAdmission(facts);
  else if (policy.approvalId !== undefined) assert(policy.approvalId.length > 0, "INVALID_EVENT", "A manual approval identity must be non-empty when present.");
}

/** Throws unless the value is a complete, well-typed set of admission dimensions whose combination is honest; it accepts untrusted input because persisted or hostile events reach it. */
export function validateAdmissionDimensions(dimensions: WorkflowAdmissionDimensions): void {
  const decoded = decode(ADMISSION_DIMENSIONS, dimensions);
  if (!decoded.ok) fail("INVALID_EVENT", `Admission dimensions are invalid: ${decoded.error.message}`);
  validateFactCombinations(decoded.value);
  validatePolicyAdmission(decoded.value.policy, decoded.value);
}

/** Throws unless every dimension's evidence was recorded for this exact job, batch and snapshot with the kind that dimension requires. */
export function validateAuthorityForAdmission(check: AdmissionAuthorityCheck): void {
  for (const key of ADMISSION_DIMENSION_KEYS) {
    const fact = check.dimensions[key];
    const evidence = check.state.authorityEvidence[fact.evidenceId];
    assert(evidence !== undefined, "INVALID_EVENT", `Admission evidence ${fact.evidenceId} is not recorded.`);
    assert(evidence.kind === AUTHORITY_KIND_BY_DIMENSION[key] && evidence.jobId === check.jobId && evidence.batchId === check.batchId && evidence.snapshotFingerprint === check.snapshotFingerprint, "INVALID_EVENT", `Admission evidence ${fact.evidenceId} does not match ${key}.`);
  }
}

function blockingPolicyReasons(dimensions: WorkflowAdmissionDimensions): string[] {
  const reasons: string[] = [];
  if (dimensions.schemaValue.state !== "valid") reasons.push("schema/value evidence is invalid");
  if (dimensions.targetDependency.state !== "resolved") reasons.push("target/dependency evidence is unresolved");
  const host = dimensions.hostCapability.state;
  if (host === "unknown" || host === "unavailable" || host === "regressed") reasons.push(`host capability is ${host}`);
  if (dimensions.recovery.state === "not_undoable") reasons.push("the operation set has no guarded undo path");
  return reasons;
}

function verificationReason(state: WorkflowAdmissionDimensions["verificationCapability"]["state"]): string[] {
  if (state === "exact") return [];
  return [state === "intrinsically_unobservable" ? "verification is intrinsically unobservable and requires explicit approval" : "verification evidence is partial"];
}

function manualPolicyReasons(dimensions: WorkflowAdmissionDimensions): string[] {
  const reasons = verificationReason(dimensions.verificationCapability.state);
  const mutation = dimensions.mutationBehavior.state;
  if (mutation === "destructive" || mutation === "external") reasons.push(`${mutation} mutation requires explicit approval`);
  if (dimensions.recovery.state === "partially_undoable") reasons.push("recovery is only partially undoable");
  return reasons;
}

/** Derives the execution policy from independently collected admission facts; it is pure and never turns a missing capability into an automatic permission. */
export function classifyWorkflowPolicy(dimensions: WorkflowAdmissionDimensions): WorkflowPolicyVerdict {
  const blockingReasons = blockingPolicyReasons(dimensions);
  if (blockingReasons.length > 0) return { policyClass: "blocked", approvalRequired: false, reasons: blockingReasons };
  if (dimensions.hostCapability.state === "probationary") return { policyClass: "probationary", approvalRequired: true, reasons: ["host capability is probationary"] };
  const manualReasons = manualPolicyReasons(dimensions);
  if (dimensions.policy.decision === "manual" || manualReasons.length > 0) {
    return { policyClass: "manual-only", approvalRequired: true, reasons: manualReasons.length > 0 ? manualReasons : ["policy requires explicit approval"] };
  }
  return { policyClass: "automatic", approvalRequired: false, reasons: [] };
}

function targetSelection(payload: ActionPlanV2Operation): string | undefined {
  if (!("target" in payload) || typeof payload.target !== "object" || payload.target === null || Array.isArray(payload.target)) return undefined;
  return "selectionFingerprint" in payload.target && typeof payload.target.selectionFingerprint === "string" ? payload.target.selectionFingerprint : undefined;
}

function hasObjectTarget(payload: ActionPlanV2Operation): boolean {
  return "target" in payload && typeof payload.target === "object" && payload.target !== null && !Array.isArray(payload.target);
}

function topLevelSelection(payload: ActionPlanV2Operation): string | undefined {
  return "selectionFingerprint" in payload && typeof payload.selectionFingerprint === "string" ? payload.selectionFingerprint : undefined;
}

function admissionSelection(payloads: readonly ActionPlanV2Operation[]): string {
  const firstTargeted = payloads.find(hasObjectTarget);
  const fromTarget = firstTargeted === undefined ? undefined : targetSelection(firstTargeted);
  return fromTarget ?? payloads.map(topLevelSelection).find((selection) => selection !== undefined) ?? "workflow-selection";
}

/** Throws unless every operation payload passes action-plan validation against the admitted snapshot. */
export function validateOperationPayloads(payloads: readonly ActionPlanV2Operation[], snapshotFingerprint: string): void {
  const plan: PlanInput = {
    schemaVersion: "0.2",
    planId: "workflow-admission",
    snapshotFingerprint,
    selectionFingerprint: admissionSelection(payloads),
    freshness: { revision: "workflow", capturedAt: "1970-01-01T00:00:00.000Z" },
    summary: "workflow admission",
    operations: [...payloads],
    requiresApproval: true,
    bounds: { maxOperations: MAX_WORKFLOW_OPERATIONS_PER_BATCH },
    preconditions: [],
    conflicts: [],
    postconditions: [],
  };
  const problems = collectOperationProblems(plan);
  assert(problems.length === 0, "INVALID_EVENT", `Operation payload failed action-plan validation: ${problems.map((problem) => `${problem.index}:${problem.code}`).join(", ")}.`);
}

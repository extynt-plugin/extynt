// Types for admitted batches: the sealed execution contract, its policy dimensions, authority evidence and the capability disclosure a model sees.

import type { ActionPlanV2Operation } from "@extynt/action-plan";
import type { WorkflowPostconditionContract } from "./evidence-types.js";
import type { WorkflowId } from "./identity.js";
import type { WORKFLOW_ENGINE_ID } from "./limits.js";

export type WorkflowCapabilityFieldType = "string" | "number" | "boolean" | "id" | "fingerprint" | "enum";
export type WorkflowAuthorityEvidenceKind = "validator" | "target_resolver" | "host_profile" | "verifier_contract" | "mutation_classification" | "recovery_audit" | "policy_decision";

/** One typed operation of an admitted batch; the payload is the immutable execution contract. */
export interface WorkflowAdmittedOperation {
  readonly operationId: WorkflowId;
  readonly ordinal: number;
  readonly type: string;
  readonly payload: ActionPlanV2Operation;
}

/** A fact the sidecar derived about an admitted batch, with the evidence that produced it. */
export interface WorkflowAdmissionFact {
  readonly evidenceId: string;
  readonly basis: string;
}

/** Whether the operation payloads satisfy their schemas and value bounds. */
export interface WorkflowSchemaValueFact extends WorkflowAdmissionFact { readonly state: "valid" | "invalid"; }

/** Whether every layer, composition or property the batch targets resolved. */
export interface WorkflowTargetDependencyFact extends WorkflowAdmissionFact { readonly state: "resolved" | "unresolved" | "unknown"; }

/** How well the host has proven it supports the batch's operations. */
export interface WorkflowHostCapabilityFact extends WorkflowAdmissionFact { readonly state: "supported" | "probationary" | "unknown" | "unavailable" | "regressed"; }

/** How exactly the batch's effect can be read back. */
export interface WorkflowVerificationCapabilityFact extends WorkflowAdmissionFact { readonly state: "exact" | "partial" | "intrinsically_unobservable"; }

/** What kind of change the batch makes to the project. */
export interface WorkflowMutationBehaviorFact extends WorkflowAdmissionFact { readonly state: "idempotent" | "ensuring" | "creating" | "destructive" | "external"; }

/** How completely the batch can be undone. */
export interface WorkflowRecoveryFact extends WorkflowAdmissionFact { readonly state: "fully_undoable" | "partially_undoable" | "not_undoable"; }

/** Whether the batch may run automatically or needs a bound approval. */
export interface WorkflowPolicyFact extends WorkflowAdmissionFact { readonly decision: "automatic" | "manual"; readonly approvalId?: string; }

/** The seven independent dimensions an admission is judged on. */
export interface WorkflowAdmissionDimensions {
  readonly schemaValue: WorkflowSchemaValueFact;
  readonly targetDependency: WorkflowTargetDependencyFact;
  readonly hostCapability: WorkflowHostCapabilityFact;
  readonly verificationCapability: WorkflowVerificationCapabilityFact;
  readonly mutationBehavior: WorkflowMutationBehaviorFact;
  readonly recovery: WorkflowRecoveryFact;
  readonly policy: WorkflowPolicyFact;
}

/** A post-admission approval tied to the sealed batch digest, snapshot and source action plan. */
export interface WorkflowApprovalBinding {
  readonly approvalId: string;
  readonly sourcePlanDigest: string;
  readonly digest: string;
  readonly snapshotFingerprint: string;
  readonly approvedAt: string;
}

/** Evidence a validator, resolver, host profile or policy recorded about a batch's snapshot. */
export interface WorkflowAuthorityEvidence {
  readonly evidenceId: string;
  readonly kind: WorkflowAuthorityEvidenceKind;
  readonly jobId: WorkflowId;
  readonly batchId: WorkflowId;
  readonly snapshotFingerprint: string;
  readonly basis: string;
  readonly recordedAt: string;
}

/** The sealed batch: digest, snapshot, single undo unit, policy dimensions and the admitted operations. */
export interface WorkflowAdmission {
  readonly digest: string;
  readonly sourcePlanId?: WorkflowId;
  readonly sourcePlanDigest?: string;
  readonly snapshotFingerprint: string;
  readonly undoUnitId: WorkflowId;
  readonly undoUnitCount: 1;
  readonly dimensions: WorkflowAdmissionDimensions;
  readonly postconditions?: readonly WorkflowPostconditionContract[];
  readonly operations: readonly WorkflowAdmittedOperation[];
  readonly admittedAt: string;
}

/** Everything the batch digest covers. */
export interface WorkflowBatchDigestInput {
  readonly jobId: WorkflowId;
  readonly stageId: WorkflowId;
  readonly batchId: WorkflowId;
  readonly dependencies: readonly WorkflowId[];
  readonly snapshotFingerprint: string;
  readonly undoUnitId: WorkflowId;
  readonly undoUnitCount: 1;
  readonly dimensions: WorkflowAdmissionDimensions;
  readonly postconditions?: readonly WorkflowPostconditionContract[];
  readonly sourcePlanId?: WorkflowId;
  readonly sourcePlanDigest?: string;
  readonly operations: readonly WorkflowAdmittedOperation[];
}

/** One field of a capability schema pack. */
export interface WorkflowCapabilityField {
  readonly name: string;
  readonly type: WorkflowCapabilityFieldType;
  readonly required: boolean;
  readonly description?: string;
  readonly enumValues?: readonly string[];
}

/** An index entry naming an operation family before its complete schema is disclosed. */
export interface WorkflowCapabilityOperationFamily {
  readonly familyId: WorkflowId;
  readonly summary: string;
  readonly operationTypes: readonly string[];
  readonly schemaPackIds: readonly WorkflowId[];
}

/** A bounded schema pack a coordinator may disclose for a relevant family. */
export interface WorkflowCapabilitySchemaPack {
  readonly schemaPackId: WorkflowId;
  readonly version: string;
  readonly summary: string;
  readonly operationTypes: readonly string[];
  readonly fields: readonly WorkflowCapabilityField[];
}

/** Progressive disclosure for one model cycle: the stable core plus requestable families and packs, never lifecycle state or host code. */
export interface WorkflowCapabilityDisclosure {
  readonly disclosureId: WorkflowId;
  readonly engineId: typeof WORKFLOW_ENGINE_ID;
  readonly stableCore: readonly string[];
  readonly operationFamilies: readonly WorkflowCapabilityOperationFamily[];
  readonly schemaPacks: readonly WorkflowCapabilitySchemaPack[];
}

// The public entry of @extynt/workflow: the lifecycle model, its pure reducer, validators, projections and the in-memory and persistent event-log stores.

export type { WorkflowAdmittedOperation, WorkflowAdmission, WorkflowAdmissionFact, WorkflowSchemaValueFact, WorkflowTargetDependencyFact, WorkflowHostCapabilityFact, WorkflowVerificationCapabilityFact, WorkflowMutationBehaviorFact, WorkflowRecoveryFact, WorkflowPolicyFact, WorkflowApprovalBinding, WorkflowCapabilityFieldType, WorkflowCapabilityField, WorkflowCapabilityOperationFamily, WorkflowCapabilitySchemaPack, WorkflowCapabilityDisclosure, WorkflowAdmissionDimensions, WorkflowAuthorityEvidenceKind, WorkflowAuthorityEvidence, WorkflowBatchDigestInput } from "./admission-types.js";
export type { WorkflowRestartDisposition, WorkflowBatchRecoveryClassification, WorkflowRecoveryReport, WorkflowRecoveryAction, WorkflowContinuationSnapshot, WorkflowContinuationOperationEvidence, WorkflowContinuationReceiptEvidence, WorkflowContinuationBatchEvidence, WorkflowContinuationCriterion, WorkflowContinuationInput } from "./continuation-types.js";
export type { WorkflowEvent, WorkflowErrorCode } from "./events.js";
export type { WorkflowExecutionState, WorkflowMutationState, WorkflowVerificationState, WorkflowVerificationKind, WorkflowVerificationCoverage, WorkflowPostconditionState, WorkflowRecoveryState, WorkflowOperationOutcomeKind, WorkflowExecutionEvidence, WorkflowVerificationEvidence, WorkflowUndoLineage, WorkflowRecoveryEvidence, WorkflowPostconditionContract, WorkflowPostconditionEvidence, WorkflowHostEvidence, WorkflowOperationOutcome, WorkflowReadbackEvidence, WorkflowCreatedBinding, WorkflowReceipt, WorkflowUndoReceipt } from "./evidence-types.js";
export type { WorkflowId } from "./identity.js";
export type { WorkflowJobStatus, WorkflowStageStatus, WorkflowBatchLifecycle, WorkflowOperationStatus, WorkflowOperation, WorkflowSuccessCriterion, WorkflowCriterionEvidence, WorkflowCriterionReference, WorkflowCompletionProposal, WorkflowObservationEvidence, WorkflowJobConstraints, WorkflowBatch, WorkflowStage, WorkflowJob, WorkflowState, WorkflowDispatchLease } from "./state-types.js";
export type { WorkflowStore, InMemoryWorkflowStore, PersistentWorkflowStore, PersistentWorkflowStoreOptions } from "./store-types.js";
export { isWorkflowId, workflowGoalDigest } from "./identity.js";
export { WORKFLOW_SCHEMA_VERSION, WORKFLOW_RESUME_SUPPORTED, WORKFLOW_ENGINE_ID, MAX_WORKFLOW_ID_LENGTH, MAX_WORKFLOW_TITLE_LENGTH, MAX_WORKFLOW_SUMMARY_LENGTH, MAX_WORKFLOW_GOAL_LENGTH, MAX_WORKFLOW_OPERATIONS_PER_BATCH, MAX_WORKFLOW_DEPENDENCIES_PER_BATCH, MAX_WORKFLOW_EVENT_SIGNATURES, MAX_WORKFLOW_JOBS, MAX_WORKFLOW_STAGES_PER_JOB, MAX_WORKFLOW_BATCHES_PER_JOB, MAX_WORKFLOW_EVENT_LOG_BYTES, MAX_WORKFLOW_EVENT_BYTES, MAX_WORKFLOW_JSON_DEPTH, MAX_WORKFLOW_JSON_NODES, MAX_WORKFLOW_STRING_BYTES, MAX_WORKFLOW_ARRAY_ITEMS, MAX_WORKFLOW_OBJECT_KEYS, MAX_WORKFLOW_CRITERIA_PER_OWNER, MAX_WORKFLOW_PROVIDER_CYCLES, MAX_WORKFLOW_AUTOMATIC_REPAIRS, MAX_WORKFLOW_CONTINUATION_BATCHES, MAX_WORKFLOW_CONTINUATION_BLOCKERS, MAX_WORKFLOW_CONTINUATION_BINDINGS, MAX_WORKFLOW_POSTCONDITIONS, MAX_WORKFLOW_HOST_EVIDENCE, MAX_WORKFLOW_CAPABILITY_FAMILIES, MAX_WORKFLOW_CAPABILITY_SCHEMA_PACKS, MAX_WORKFLOW_CAPABILITY_OPERATIONS, MAX_WORKFLOW_CAPABILITY_FIELDS } from "./limits.js";
export { WorkflowTransitionError, WorkflowStorageError } from "./errors.js";
export type { WorkflowStorageErrorCode } from "./errors.js";
export { validateAdmissionDimensions, classifyWorkflowPolicy } from "./admission-validation.js";
export type { WorkflowPolicyClass, WorkflowPolicyVerdict } from "./admission-validation.js";
export { validateHostEvidence, validatePostconditionContracts, validatePostconditionEvidence } from "./verification.js";
export { validateWorkflowCapabilityDisclosure } from "./capability-disclosure.js";
export { presentWorkflowState } from "./presentation.js";
export type { WorkflowPresentationStatus, WorkflowBatchPresentation, WorkflowJobPresentation, WorkflowPresentation } from "./presentation.js";
export { stageBatchesConfirmed } from "./stage-confirmation.js";
export { readbackRepaired } from "./readback-repair.js";
export type { OperationLookup } from "./readback-repair.js";
export { receiptVerificationKinds, workflowVerificationCoverage } from "./verification-coverage.js";
export { WORKFLOW_BATCH_BUDGET, analyzeWorkflowBatch } from "./batch-closure.js";
export type {
  WorkflowBatchBudget,
  WorkflowBatchClosure,
  WorkflowBatchClosureCode,
  WorkflowBatchClosureFailure,
  WorkflowBatchClosureResult,
  WorkflowBatchDependency,
} from "./batch-closure.js";
export { computeWorkflowBatchDigest } from "./canonical-json.js";
export { createWorkflowState } from "./state.js";
export { buildWorkflowContinuationInput } from "./continuation.js";
export type { WorkflowContinuationOptions } from "./continuation.js";
export { declaredWorkflowCreatedPlaceholders } from "./created-bindings.js";
export { redactWorkflowText } from "./redaction.js";
export { applyWorkflowEvent, replayWorkflowEvents, serializeWorkflowState } from "./reducer.js";
export { createInMemoryWorkflowStore } from "./store.js";
export { createPersistentWorkflowStore } from "./persistent-store.js";
export { classifyWorkflowBatchRecovery, classifyWorkflowRecovery } from "./restart-recovery.js";
export { WORKFLOW_STORAGE_FORMAT, WORKFLOW_STORAGE_VERSION, MAX_WORKFLOW_STORAGE_BYTES } from "./storage-format.js";

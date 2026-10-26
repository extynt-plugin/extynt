// Verifier contracts and evidence: bounds and identity rules for declared postconditions, receipt postcondition evidence and host evidence.

import { assert, boundedText, id, timestamp } from "./assertions.js";
import { signature } from "./canonical-json.js";
import type { WorkflowHostEvidence, WorkflowPostconditionContract, WorkflowPostconditionEvidence, WorkflowReceipt } from "./evidence-types.js";
import type { WorkflowErrorCode } from "./events.js";
import { frozenCopy } from "./frozen-state.js";
import type { MutableWorkflowState } from "./frozen-state.js";
import { MAX_WORKFLOW_HOST_EVIDENCE, MAX_WORKFLOW_ID_LENGTH, MAX_WORKFLOW_POSTCONDITIONS, MAX_WORKFLOW_SUMMARY_LENGTH } from "./limits.js";
import type { WorkflowBatch } from "./state-types.js";

const FINGERPRINT_MAX = MAX_WORKFLOW_ID_LENGTH * 4;
const RENDERED_KINDS: ReadonlySet<string> = new Set(["visual", "temporal"]);

interface UniqueListRule<Item> {
  readonly max: number;
  readonly overBound: string;
  readonly duplicateCode: WorkflowErrorCode;
  readonly duplicate: string;
  readonly identity: (item: Item) => string;
  readonly validate: (item: Item) => void;
}

function validatedUniqueList<Item>(items: readonly Item[] | undefined, rule: UniqueListRule<Item>): readonly Item[] {
  if (items === undefined) return [];
  assert(items.length <= rule.max, "LIMIT_EXCEEDED", rule.overBound);
  const seen = new Set<string>();
  for (const item of items) {
    rule.validate(item);
    assert(!seen.has(rule.identity(item)), rule.duplicateCode, rule.duplicate);
    seen.add(rule.identity(item));
  }
  return items;
}

const CONTRACTS: UniqueListRule<WorkflowPostconditionContract> = {
  max: MAX_WORKFLOW_POSTCONDITIONS,
  overBound: "Postcondition contracts exceed the workflow bound.",
  duplicateCode: "INVALID_EVENT",
  duplicate: "Postcondition contract IDs must be unique.",
  identity: (contract) => contract.postconditionId,
  validate: (contract) => {
    id(contract.postconditionId, "postconditionId");
    boundedText(contract.description, "postcondition description", MAX_WORKFLOW_SUMMARY_LENGTH);
  },
};

function validateEvidence(evidence: WorkflowPostconditionEvidence): void {
  id(evidence.postconditionId, "postcondition evidence ID");
  boundedText(evidence.basis, "postcondition evidence basis", MAX_WORKFLOW_SUMMARY_LENGTH);
  const passedRendered = RENDERED_KINDS.has(evidence.kind) && evidence.state === "passed";
  assert(!(passedRendered && evidence.basis === "legacy receipt structural readback"), "INVALID_RECEIPT", "Legacy structural read-back cannot pass a visual or temporal postcondition.");
  if (evidence.observedFingerprint !== undefined) boundedText(evidence.observedFingerprint, "postcondition evidence fingerprint", FINGERPRINT_MAX);
  assert(!(passedRendered && !evidence.observedFingerprint), "INVALID_RECEIPT", "Passed visual and temporal postconditions must identify the rendered snapshot they inspected.");
}

const POSTCONDITION_EVIDENCE: UniqueListRule<WorkflowPostconditionEvidence> = {
  max: MAX_WORKFLOW_POSTCONDITIONS,
  overBound: "Postcondition evidence exceeds the workflow bound.",
  duplicateCode: "DUPLICATE_EVENT_CONFLICT",
  duplicate: "Postcondition evidence IDs must be unique.",
  identity: (evidence) => evidence.postconditionId,
  validate: validateEvidence,
};

function validateHostEvidenceItem(evidence: WorkflowHostEvidence): void {
  id(evidence.evidenceId, "host evidence ID");
  id(evidence.jobId, "host evidence job ID");
  id(evidence.batchId, "host evidence batch ID");
  if (evidence.operationId !== undefined) id(evidence.operationId, "host evidence operation ID");
  boundedText(evidence.basis, "host evidence basis", MAX_WORKFLOW_SUMMARY_LENGTH);
  if (evidence.observedFingerprint !== undefined) boundedText(evidence.observedFingerprint, "host evidence fingerprint", FINGERPRINT_MAX);
  timestamp(evidence.recordedAt);
}

const HOST_EVIDENCE: UniqueListRule<WorkflowHostEvidence> = {
  max: MAX_WORKFLOW_HOST_EVIDENCE,
  overBound: "Host evidence exceeds the workflow bound.",
  duplicateCode: "DUPLICATE_EVENT_CONFLICT",
  duplicate: "Host evidence IDs must be unique.",
  identity: (evidence) => evidence.evidenceId,
  validate: validateHostEvidenceItem,
};

/** Returns the declared postcondition contracts after bounding them and requiring distinct, well-formed ids. */
export function validatePostconditionContracts(contracts: readonly WorkflowPostconditionContract[] | undefined): readonly WorkflowPostconditionContract[] {
  return validatedUniqueList(contracts, CONTRACTS);
}

/** Returns a receipt's postcondition evidence after bounding it and requiring distinct ids and an honest rendered-snapshot basis. */
export function validatePostconditionEvidence(evidence: readonly WorkflowPostconditionEvidence[] | undefined): readonly WorkflowPostconditionEvidence[] {
  return validatedUniqueList(evidence, POSTCONDITION_EVIDENCE);
}

/** Returns a receipt's host evidence after bounding it and requiring distinct, well-formed entries. */
export function validateHostEvidence(evidence: readonly WorkflowHostEvidence[] | undefined): readonly WorkflowHostEvidence[] {
  return validatedUniqueList(evidence, HOST_EVIDENCE);
}

function assertEvidenceMatchesContracts(contracts: readonly WorkflowPostconditionContract[], evidence: readonly WorkflowPostconditionEvidence[]): void {
  const byId = new Map(contracts.map((contract) => [contract.postconditionId, contract]));
  for (const item of evidence) {
    const contract = byId.get(item.postconditionId);
    assert(contract !== undefined && contract.kind === item.kind, "INVALID_RECEIPT", "Receipt postcondition evidence must match the admitted verifier contract.");
  }
}

/**
 * Checks a receipt against the verifier contract its batch was admitted with: every evidence row matches a declared
 * contract, and a verified receipt passes every required postcondition. A batch admitted without typed contracts
 * can never have a required postcondition established by receipt evidence.
 */
export function validateReceiptVerificationContract(current: WorkflowBatch, receipt: WorkflowReceipt): void {
  const contracts = current.admission?.postconditions ?? [];
  const evidence = validatePostconditionEvidence(receipt.postconditions);
  assertEvidenceMatchesContracts(contracts, evidence);
  if (contracts.length === 0 || receipt.verification !== "verified") return;
  for (const contract of contracts.filter((candidate) => candidate.required)) {
    const result = evidence.find((item) => item.postconditionId === contract.postconditionId);
    assert(result?.state === "passed", "INVALID_RECEIPT", "A verified receipt must pass every required postcondition.");
  }
}

/** Appends a receipt's host evidence to the state's ledger, refusing evidence of another batch or an operation the batch never admitted. */
export function recordReceiptHostEvidence(next: MutableWorkflowState, current: WorkflowBatch, receipt: WorkflowReceipt): void {
  const evidence = validateHostEvidence(receipt.hostEvidence);
  const operationIds = new Set(current.operationIds);
  const ledger = { ...next.hostEvidence };
  for (const item of evidence) {
    assert(item.jobId === current.jobId && item.batchId === current.batchId, "WRONG_OWNER", "Host evidence belongs to another workflow batch.");
    assert(item.operationId === undefined || operationIds.has(item.operationId), "INVALID_RECEIPT", "Host evidence operation is not admitted in this batch.");
    if (receipt.observedFingerprint !== undefined) assert(item.observedFingerprint === undefined || item.observedFingerprint === receipt.observedFingerprint, "INVALID_RECEIPT", "Host evidence must match the receipt snapshot.");
    const prior = ledger[item.evidenceId];
    assert(prior === undefined || signature(prior) === signature(item), "DUPLICATE_EVENT_CONFLICT", `Host evidence ${item.evidenceId} was already recorded with different evidence.`);
    ledger[item.evidenceId] = frozenCopy(item);
  }
  next.hostEvidence = ledger;
}

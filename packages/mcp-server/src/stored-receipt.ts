// The receipt a stored plan holds: its exact shape, and the readings of it that the plan tools share.
import type { StoredPlan } from "./contracts.js";
import { jsonRecordOf, numberAt, stringAt } from "./json.js";
import type { JsonObject, JsonValue } from "@extynt/decode";

/** A failure the host or the sidecar reported, with its code and message. */
export interface ReceiptFailure { readonly code: string; readonly message: string }

/** What an undo receipt says about the undo it records. */
export interface UndoDetails {
  readonly executed?: boolean;
  readonly groups?: number;
  readonly undone?: number;
  readonly remaining?: number;
  readonly method?: string | null;
  readonly restoredPreApplyFingerprint?: boolean;
  readonly leftBehind?: ReadonlyArray<string>;
  readonly leftBehindNote?: string;
  readonly action?: string;
  readonly differences?: ReadonlyArray<string>;
  readonly redone?: true;
  readonly redoFailed?: true;
}

/** The host build an apply ran on. */
export interface ReceiptHostStamp { readonly version: string; readonly family: string; readonly measured: boolean; readonly experimental: boolean }

/**
 * A receipt as the plan store keeps it: an apply receipt, an undo receipt, or the receipt of a plan that never reached the host.
 * The host's verification report, the repair rows and the per-step evidence stay JSON because the host decides their fields.
 */
export interface StoredReceipt {
  receiptId?: string | undefined;
  planId?: string | undefined;
  operation?: string | undefined;
  status?: string | undefined;
  receivedAt?: string | undefined;
  postcondition?: string | undefined;
  approvalId?: string | null | undefined;
  beforeFingerprint?: string | undefined;
  afterFingerprint?: string | null | undefined;
  afterRevision?: string | null | undefined;
  appliedOperations?: ReadonlyArray<string> | undefined;
  completedOperations?: ReadonlyArray<string> | undefined;
  externalOutputs?: ReadonlyArray<{ readonly path: string; readonly operation: string }> | undefined;
  managedSources?: ReadonlyArray<JsonObject> | undefined;
  mayHaveMutated?: boolean | undefined;
  mutationState?: string | undefined;
  rollback?: string | null | undefined;
  undoGroups?: number | undefined;
  batchSize?: number | undefined;
  hostProbeMs?: number | undefined;
  hostApplyMs?: number | undefined;
  verifyProbeMs?: number | undefined;
  verificationTrimmed?: true | undefined;
  creationEvidence?: ReadonlyArray<JsonObject> | undefined;
  frameChecks?: ReadonlyArray<JsonObject> | undefined;
  keyframeSteps?: ReadonlyArray<JsonObject> | undefined;
  created?: JsonObject | undefined;
  repair?: { readonly failedCount: number; readonly operations: ReadonlyArray<JsonObject> } | undefined;
  verification?: JsonObject | undefined;
  failure?: JsonObject | undefined;
  target?: JsonObject | undefined;
  hostError?: ReceiptFailure | undefined;
  error?: ReceiptFailure | undefined;
  host?: ReceiptHostStamp | undefined;
  hostChangedSinceApply?: true | undefined;
  times?: number | undefined;
  groups?: number | undefined;
  undone?: number | undefined;
  undo?: UndoDetails | undefined;
  operationOutcomes?: ReadonlyArray<JsonObject> | undefined;
  outcomeCounts?: JsonObject | undefined;
  cancelledDuringApply?: true | undefined;
  graphSynchronization?: JsonValue | undefined;
  jobUndo?: JsonObject | undefined;
  frame?: JsonValue | undefined;
  effectControls?: JsonValue | undefined;
  postconditions?: JsonValue | undefined;
}

const MAX_UNDO_GROUPS = 1000;

/** The plan's receipt as a JSON object, or undefined when none was posted. */
export function receiptOf(record: Pick<StoredPlan, "receipt">): JsonObject | undefined {
  return receiptJson(record.receipt);
}

/** A receipt as the JSON object it travels as, or undefined when there is none. */
export function receiptJson(receipt: StoredReceipt | undefined): JsonObject | undefined {
  return receipt && jsonRecordOf(receipt);
}

/** How many undo groups an apply produced: 1 unless the host said otherwise, 0 when it reported that none holds a step. */
export function undoGroupsOf(receipt: JsonObject | undefined): number {
  const groups = numberAt(receipt, "undoGroups");
  if (groups === 0) return 0;
  return groups !== undefined && groups >= 1 ? Math.min(MAX_UNDO_GROUPS, Math.floor(groups)) : 1;
}

/** The whole number of undo groups already pressed for the plan. */
export function undoneGroupsOf(record: Pick<StoredPlan, "undo">): number {
  return Math.max(0, Math.floor(record.undo?.undone ?? 0));
}

/** When the host received the apply, as milliseconds since the epoch. */
export function receivedAtOf(receipt: JsonObject | undefined): number | undefined {
  const parsed = Date.parse(stringAt(receipt, "receivedAt") ?? "");
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** The receipt's status word, when it has one. */
export function receiptStatusOf(receipt: JsonObject | undefined): string | undefined {
  return stringAt(receipt, "status");
}

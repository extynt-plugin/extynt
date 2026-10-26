/** The shapes the verify and receipt code reads from host snapshots, apply commands and apply results; the host owns every field not named here. */
import type { JsonObject, JsonValue } from "@extynt/decode";
import type { HostErrorBody } from "./apply-reply.js";
import type { FrameCheckRow, HostFrameCheck } from "./frame-check.js";
import type { CreationEvidence } from "./creation-evidence.js";
import type { ExpressionLine } from "./expression-lines.js";
import type { RepairPacket } from "./receipt-text.js";
import type { VerifiedStep } from "./verdicts.js";
import type { PlanOperation } from "./verify-types.js";

interface HostSnapshotComposition {
  id: string;
  width: number;
  height: number;
}
interface HostSnapshotResult {
  compositions?: HostSnapshotComposition[];
  activeCompositionId?: string | null;
  currentTime?: number;
}
export interface HostSnapshot {
  ok?: boolean;
  requestId?: string;
  error?: { code?: string; message?: string; retryable?: boolean; raw?: JsonValue; details?: JsonObject } | null;
  result?: HostSnapshotResult | null;
  warnings?: JsonValue[];
}
interface OperationTarget {
  itemId?: string | undefined;
  compositionId?: string | undefined;
  layerId?: string | undefined;
  layerIds?: ReadonlyArray<string> | undefined;
}
interface OperationRow extends OperationTarget {
  operation?: string | undefined;
  type?: string | undefined;
  target?: OperationTarget | undefined;
}
export interface ApplyCommand {
  operation?: string;
  planId?: string;
  operations?: ReadonlyArray<OperationRow | string | number>;
  batchSize?: number;
  readSet?: JsonObject;
  expectedStamp?: JsonValue;
}
export interface ApprovedData {
  planId?: string;
  command?: ApplyCommand | null;
  reads?: JsonObject;
  approval?: { token?: string; readSetDigest?: JsonValue } | null;
  plan?: { snapshotFingerprint?: string; selectionFingerprint?: string; operations?: PlanOperation[] } | null;
}
export interface HostApplyResult {
  ok?: boolean;
  frameChecks?: ReadonlyArray<HostFrameCheck> | undefined;
  steps?: ReadonlyArray<JsonObject> | undefined;
  undoGroups?: number | undefined;
  changedUndoGroups?: number | undefined;
  batchSize?: number | undefined;
  mutationState?: string | undefined;
  mayHaveMutated?: boolean | undefined;
  phase?: string | undefined;
  failedOperationIndex?: number | undefined;
  failedOperation?: string | undefined;
  error?: HostErrorBody | null;
  receipt?: { rollback?: string | undefined } | null | undefined;
  creationEvidence?: JsonValue | undefined;
  externalOutputs?: ReadonlyArray<JsonValue> | undefined;
  managedSources?: ReadonlyArray<JsonValue> | undefined;
  metadataReadback?: JsonValue | undefined;
  method?: string;
}
interface ReceiptVerification {
  snapshotRequestId: string | null;
  targetFound: boolean;
  steps: ReadonlyArray<VerifiedStep>;
  expressions?: ReadonlyArray<ExpressionLine>;
}
interface KeyframeStep {
  propertyPath: string;
  keyframeMode: string | null;
  removedKeys: number;
  afterKeys: number | null;
}
export type ReceiptDraft = {
  planId?: string | undefined;
  operation?: string;
  hostProbeMs?: number | undefined;
  hostApplyMs?: number | undefined;
  scopedUndoUnsupported?: boolean;
  status?: string;
  undoGroups?: number | undefined;
  batchSize?: number | undefined;
  created?: Readonly<Record<string, string>> | undefined;
  keyframeSteps?: ReadonlyArray<KeyframeStep> | undefined;
  managedSources?: ReadonlyArray<JsonValue> | undefined;
  approvalId?: string | null | undefined;
  beforeFingerprint?: string | null | undefined;
  afterFingerprint?: string;
  appliedOnInstance?: string;
  appliedOperations?: ReadonlyArray<string>;
  completedOperations?: ReadonlyArray<string> | undefined;
  mayHaveMutated?: boolean;
  frameChecks?: ReadonlyArray<FrameCheckRow> | undefined;
  rollback?: string | undefined;
  postcondition?: string;
  creationEvidence?: ReadonlyArray<CreationEvidence> | undefined;
  externalOutputs?: ReadonlyArray<JsonValue> | undefined;
  mutationState?: string | undefined;
  failure?: { phase: string; operationIndex: number; operation: string | null } | undefined;
  hostError?: { code: string; message: string } | undefined;
  error?: { code: string; message: string } | undefined;
  metadataReadback?: JsonValue | undefined;
  verificationTrimmed?: boolean;
  verifyProbeMs?: number | undefined;
  afterRevision?: string | null;
  repair?: RepairPacket;
  verification?: ReceiptVerification | null | undefined;
};
/** What the apply runner knows when it builds a receipt: the approved plan, the command it ran and the read taken before it. */
export interface ApplyContext {
  approvedData: ApprovedData;
  command: ApplyCommand;
  approval?: { token?: string; readSetDigest?: JsonValue } | null | undefined;
  hostProbeMs?: number;
  preApplySnapshot?: HostSnapshot | null;
}
export interface PreApplyFailure {
  code: string;
  retryable: boolean;
  message: string;
}

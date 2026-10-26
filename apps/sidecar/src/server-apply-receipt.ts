// Builds the stored apply receipt from the wire receipt: every field bounded, the host that ran it named, and the key order the stored files have always had.
import { isJsonObject, type JsonObject, type JsonValue } from "@extynt/decode";
import { jsonFieldsOf, type StoredReceipt } from "@extynt/mcp-server";
import { boundedCreationEvidence } from "./verify/creation-evidence.js";
import { boundedFrameChecks } from "./verify/frame-check.js";
import { boundedCount, boundedCreatedBindings, boundedExternalOutputs, boundedKeyframeSteps, boundedManagedSources, boundedOperations, boundedText, hostHopMs, type ReceiptHead } from "./server-receipt-body.js";
import type { ApplyReceiptAdmission } from "./server-receipt-admission.js";
import type { ReceiptContext } from "./server-receipt-context.js";
import { boundedFailure, boundedRepair, boundedVerification } from "./server-evidence.js";
import { boundedHostError } from "./server-host-error.js";

type CoreKey = "planId" | "status" | "receivedAt" | "operation";
type ReceiptPart = Omit<StoredReceipt, CoreKey>;

/** An apply receipt as it is stored: always naming its plan, status, time and operation. */
export type StoredApplyReceipt = StoredReceipt & { planId: string; status: string; receivedAt: string; operation: string };

const MAX_UNDO_GROUPS = 1000;

function optionalFields(head: ReceiptHead): ReceiptPart {
  const { wire } = head;
  const repair = boundedRepair(wire.repair);
  const keyframeSteps = boundedKeyframeSteps(wire.keyframeSteps);
  const created = boundedCreatedBindings(wire.created);
  const frameChecks = boundedFrameChecks(wire.frameChecks);
  return {
    ...(head.receiptId ? { receiptId: head.receiptId } : {}),
    ...(repair ? { repair } : {}),
    ...(keyframeSteps?.length ? { keyframeSteps } : {}),
    ...(created && Object.keys(created).length ? { created } : {}),
    ...(frameChecks ? { frameChecks: frameChecks.map((row) => jsonFieldsOf(row)) } : {}),
  };
}

function coreFields(head: ReceiptHead, admission: ApplyReceiptAdmission, receivedAt: string): StoredApplyReceipt {
  const { wire } = head;
  return {
    planId: admission.planId,
    status: head.status.slice(0, 32),
    operation: boundedText(wire.operation, 64, "unknown"),
    receivedAt,
    postcondition: boundedText(wire.postcondition, 32, "unknown"),
    approvalId: boundedText(wire.approvalId, 128, null),
    ...(typeof wire.beforeFingerprint === "string" ? { beforeFingerprint: wire.beforeFingerprint.slice(0, 256) } : {}),
    afterRevision: boundedText(wire.afterRevision, 256, null),
  };
}

function measurementFields(head: ReceiptHead): ReceiptPart {
  const { wire } = head;
  const mutationState = typeof wire.mutationState === "string" ? wire.mutationState.slice(0, 64) : head.mayHaveMutated ? "mutation-unknown" : "not-applied";
  return {
    appliedOperations: boundedOperations(wire.appliedOperations),
    completedOperations: boundedOperations(wire.completedOperations),
    externalOutputs: boundedExternalOutputs(wire.externalOutputs),
    managedSources: boundedManagedSources(wire.managedSources),
    mayHaveMutated: head.mayHaveMutated,
    mutationState,
    rollback: boundedText(wire.rollback, 96, null),
    undoGroups: wire.undoGroups === 0 ? 0 : boundedCount(wire.undoGroups, MAX_UNDO_GROUPS),
    batchSize: boundedCount(wire.batchSize, MAX_UNDO_GROUPS),
    hostProbeMs: hostHopMs(wire.hostProbeMs),
    hostApplyMs: hostHopMs(wire.hostApplyMs),
    verifyProbeMs: hostHopMs(wire.verifyProbeMs),
  };
}

function verificationOf(value: JsonValue | undefined): JsonObject | undefined {
  return value !== undefined && isJsonObject(value) ? boundedVerification(value) : undefined;
}

function evidenceFields(head: ReceiptHead): ReceiptPart {
  const { wire } = head;
  return {
    ...(wire.verificationTrimmed === true ? { verificationTrimmed: true } : {}),
    creationEvidence: boundedCreationEvidence(wire.creationEvidence)?.map((row) => jsonFieldsOf(row)),
    hostError: boundedHostError(wire.hostError),
    target: isJsonObject(wire.target) ? wire.target : undefined,
    verification: verificationOf(wire.verification),
    failure: boundedFailure(wire.failure),
  };
}

function hostStamp(context: ReceiptContext, head: ReceiptHead): ReceiptPart {
  const status = context.state.hostLink.status();
  const host = status.host;
  const fromInstanceId = typeof head.wire.appliedOnInstance === "string" ? head.wire.appliedOnInstance : undefined;
  if (fromInstanceId !== undefined && status.instanceId !== null && fromInstanceId !== status.instanceId) return { hostChangedSinceApply: true };
  return host ? { host: { version: host.version.slice(0, 64), family: host.family, measured: host.measured, experimental: host.experimental } } : {};
}

/** The stored receipt for an apply the host reported. */
export function buildApplyReceipt(context: ReceiptContext, head: ReceiptHead, admission: ApplyReceiptAdmission): StoredApplyReceipt {
  const receivedAt = context.state.now().toISOString();
  return {
    ...optionalFields(head),
    ...coreFields(head, admission, receivedAt),
    afterFingerprint: context.planState.normalizedLatest()?.fingerprint ?? null,
    ...measurementFields(head),
    ...hostStamp(context, head),
    ...evidenceFields(head),
  };
}

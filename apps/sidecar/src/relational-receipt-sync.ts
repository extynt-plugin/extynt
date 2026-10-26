/**
 * Settles the desired parameter request after an apply receipt: when the receipt, the bridge ticket and the native readback
 * all bind to the approved read set, the verified readback is recorded; otherwise the desired request is invalidated.
 */
import { createHash } from "node:crypto";
import type { StoredPlan, StoredReceipt } from "@extynt/mcp-server";
import { stableStringify } from "@extynt/project-graph";
import type { NativeBridgeLease } from "./native-bridge-lease.js";
import { approvedParameterReadSet, type RelationalApplyState } from "./relational-native-binding.js";
import { confirmedParameterReadback } from "./relational-readback-proof.js";
import type { GraphRecord } from "./graph-record.js";
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { SidecarState } from "./server-state.js";
import type { Opaque } from "./snapshot-view.js";

type Receipt = StoredReceipt;
interface ParameterReceiptSync {
  state: RelationalApplyState & { nativeBridge: NativeBridgeLease; activePanelInstanceId?: string | undefined } & Pick<SidecarState, "latest" | "awaitingFreshSnapshotAfterPair">;
  record: StoredPlan | undefined;
  receipt: Receipt;
  panelInstanceId: string | undefined;
  readback: Opaque;
}
function proofReference(receipt: Receipt, ticket: string, proof: GraphRecord): string {
  if (typeof receipt.receiptId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(receipt.receiptId)) return receipt.receiptId;
  return "native-readback-sha256:" + createHash("sha256").update(stableStringify({ planId: receipt.planId, ticket, proof })).digest("hex");
}
function verifiedReceipt(receipt: Receipt): boolean {
  return receipt.operation === "apply_plan" && receipt.status === "executed" && receipt.postcondition === "passed"
    && receipt.mutationState === "applied" && receipt.verificationTrimmed !== true;
}
interface ReceiptBinding { before: ProjectSnapshot; request: GraphRecord; ticket: string; owner: string }
function ownerOf(input: ParameterReceiptSync, request: GraphRecord): string | undefined {
  const owner = input.panelInstanceId;
  return owner && owner === input.state.activePanelInstanceId && request.panelInstanceId === owner ? owner : undefined;
}
function receiptBinding(input: ParameterReceiptSync, record: StoredPlan): ReceiptBinding | undefined {
  const { state } = input, planId = record.plan.planId, desired = state.collection.desiredParameterPlan(planId), before = state.preApply;
  if (!verifiedReceipt(input.receipt) || desired.state !== "present" || before?.planId !== planId) return undefined;
  const request = desired.request, owner = ownerOf(input, request);
  if (!owner || request.status !== "bound" || typeof request.ticket !== "string") return undefined;
  return { before: before.snapshot, request, ticket: request.ticket, owner };
}
function receiptProof(record: StoredPlan, binding: ReceiptBinding, readback: Opaque): GraphRecord | undefined {
  const readSet = approvedParameterReadSet(record, binding.before);
  if (!readSet || binding.request.readSetDigest !== readSet.digest || binding.request.sourceObservationId !== record.relationalParameter?.sourceObservationId) return undefined;
  return confirmedParameterReadback({ readSet, before: binding.before, readback });
}
function latestProofMatches(input: ParameterReceiptSync, proof: GraphRecord): boolean {
  return !input.state.awaitingFreshSnapshotAfterPair && !!input.state.latest
    && stableStringify(input.state.latest.snapshot.result.hostStamp) === stableStringify(proof.stamp);
}
/** Called only after the existing receipt admission and workflow settlement accept the outcome: records the verified readback, or invalidates the desired request. */
export function synchronizeParameterReceipt(input: ParameterReceiptSync): GraphRecord | undefined {
  const { state, receipt, record } = input;
  if (!record?.relationalParameter) return undefined;
  const planId = record.plan.planId, binding = receiptBinding(input, record);
  const invalidate = (): GraphRecord => state.collection.invalidateDesired(planId);
  if (!binding || !state.nativeBridge.mutationCallbackMatches(binding.owner, binding.ticket, planId)) return invalidate();
  const proof = receiptProof(record, binding, input.readback);
  if (!proof || !latestProofMatches(input, proof)) return invalidate();
  return state.collection.observeVerifiedReadback({ planId, ticket: binding.ticket, panelInstanceId: binding.owner,
    readSetDigest: String(proof.readSetDigest), sourceObservationId: record.relationalParameter.sourceObservationId,
    receiptReference: proofReference(receipt, binding.ticket, proof), readback: proof });
}

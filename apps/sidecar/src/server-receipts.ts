// The receipt intake: logs every receipt, then settles it as an undo receipt or admits, builds and settles it as an apply receipt.
import { isJsonObject } from "@extynt/decode";
import type { ReceiverOutcome } from "./receiver-types.js";
import { buildApplyReceipt } from "./server-apply-receipt.js";
import { settleApplyReceipt } from "./server-apply-settlement.js";
import type { LogFields } from "./server-plan-log.js";
import { receiptAdmission, receiptAdmissionRefusal } from "./server-receipt-admission.js";
import type { ReceiptHead } from "./server-receipt-body.js";
import type { ReceiptContext } from "./server-receipt-context.js";
import { boundedFailure } from "./server-evidence.js";
import { boundedHostError } from "./server-host-error.js";
import { recordUndoReceipt } from "./server-undo-receipt.js";

/** Accepts the receipts the host reports. */
export interface ReceiptsCapability {
  acceptReceipt(head: ReceiptHead, hostInstanceId?: string): ReceiverOutcome;
}

const HOST_MESSAGE_CHARS = 256;

function logDetail(head: ReceiptHead): LogFields {
  const hostError = boundedHostError(head.wire.hostError);
  const failure = boundedFailure(head.wire.failure);
  const index = failure?.operationIndex;
  const failed = typeof index === "number" && index >= 0 && failure ? { failedIndex: index, failedOperation: failure.operation ?? null, failedPhase: failure.phase } : {};
  return { ...(hostError && head.status !== "executed" ? { hostMessage: hostError.message.slice(0, HOST_MESSAGE_CHARS) } : {}), ...failed };
}

function hostErrorCode(head: ReceiptHead): string | null {
  const hostError = head.wire.hostError;
  if (!hostError || !isJsonObject(hostError)) return null;
  return String(hostError.code ?? "") || null;
}

function logReceipt(context: ReceiptContext, head: ReceiptHead): void {
  context.planLog.logPlanEvent("plan.receipt", {
    planId: head.planId, status: head.status, operation: head.operation ?? null, mayHaveMutated: head.mayHaveMutated, postcondition: head.postcondition ?? null,
    hostError: hostErrorCode(head), ...logDetail(head),
  });
}

function acceptApplyReceipt(context: ReceiptContext, head: ReceiptHead, hostInstanceId: string | undefined): ReceiverOutcome {
  const admission = receiptAdmission(context, head);
  const refusal = receiptAdmissionRefusal(head, admission);
  if (refusal) return refusal;
  const receipt = buildApplyReceipt(context, head, admission);
  return settleApplyReceipt({ context, receipt, admission, panelInstanceId: hostInstanceId, readback: head.wire.metadataReadback });
}

/** Builds the receipt intake over the sidecar state and capabilities. */
export function createReceipts(context: ReceiptContext): ReceiptsCapability {
  return {
    acceptReceipt(head, hostInstanceId) {
      context.planState.markPanelSeen();
      logReceipt(context, head);
      return head.operation === "undo_plan" ? recordUndoReceipt(context, head) : acceptApplyReceipt(context, head, hostInstanceId);
    },
  };
}

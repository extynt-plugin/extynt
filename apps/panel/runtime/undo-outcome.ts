/**
 * What an Undo press actually did. The undo tool answers ok once the request is accepted and then
 * waits for the panel's receipt, so "ok" alone says nothing: a refusal comes back as ok with a
 * rejected receipt, a workflow refusal as ok with nothing queued, a busy lane as ok and still queued.
 */
import type { Infer } from "@extynt/decode";
import { t } from "./panel-language.js";
import { receiptDecoder } from "./receipt.js";
import type { Receipt } from "./receipt.js";
import { fallback, literal, object, string } from "@extynt/decode";

/** The `data` of a successful undo call. */
export const undoDataDecoder = object({ status: fallback(string(), null), workflowRefused: fallback(literal(true), false), receipt: fallback(receiptDecoder, null) });

type UndoData = Infer<typeof undoDataDecoder>;
/** `problem` is set when nothing was undone; `status` is the plan's new status when the answer names one. */
export interface UndoOutcome {
  readonly problem: string | null;
  readonly text: string;
  readonly status: string | null;
}

function requested(): UndoOutcome {
  return { problem: null, text: t("chat.undo.queued"), status: "undo_requested" };
}

function statusOutcome(status: string): UndoOutcome | undefined {
  if (status === "undone") return { problem: null, text: t("chat.undo.undone"), status: "undone" };
  if (status === "partially_undone") return { problem: null, text: t("chat.undo.partiallyUndone"), status: "partially_undone" };
  if (status === "undo_unverified") return { problem: t("chat.undo.unverified"), text: "", status: "undo_unverified" };
  return undefined;
}

function reason(receipt: Receipt): string {
  return receipt.hostError?.message || receipt.error?.message || t("chat.undo.noReason");
}

function receiptFailure(receipt: Receipt | null): UndoOutcome | null {
  if (receipt?.status === "rejected") return { problem: t("chat.undo.rejected", { reason: reason(receipt) }), text: "", status: null };
  if (receipt?.status === "unknown") return { problem: t("chat.undo.unknown", { reason: reason(receipt) }), text: "", status: null };
  return null;
}

/** The outcome an undo answer amounts to. */
export function undoOutcome(data: UndoData): UndoOutcome {
  if (data.workflowRefused) return { problem: t("chat.undo.workflowRefused"), text: "", status: null };
  if (data.status === "undo_requested") return requested();
  const failed = receiptFailure(data.receipt);
  if (failed) return failed;
  return (data.status ? statusOutcome(data.status) : undefined) ?? { problem: null, text: t("chat.undo.requested"), status: "undo_requested" };
}

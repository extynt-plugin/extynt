/** What the buttons on a plan do: Apply, Undo, Discard and Copy receipt, all tool calls to the sidecar. */
import { mcpCall } from "./panel-mcp.js";
import { recordReceipt, setPlanStatus } from "./panel-plan-state.js";
import { receiptDecoder } from "./receipt.js";
import { undoDataDecoder, undoOutcome, type UndoOutcome } from "./undo-outcome.js";
import { fallback, type JsonObject, jsonValue, object, string } from "@extynt/decode";
import { ignored } from "./wire-decoders.js";
import { t } from "./panel-language.js";

const APPLY_WAIT_SECONDS = 20;
const UNDO_WAIT_SECONDS = 5;
const UNDO_REQUEST_TIMEOUT_MS = UNDO_WAIT_SECONDS * 1000 + 8000;
const APPLY_REQUEST_TIMEOUT_MS = (APPLY_WAIT_SECONDS + 8) * 1000;

/** How Apply ended. */
export type ApplyResult =
  | { readonly kind: "needs-acknowledgement" }
  | { readonly kind: "refused"; readonly message: string }
  | { readonly kind: "queued" | "done"; readonly status: string };

const approveDataDecoder = object({ status: fallback(string(), "approved"), receipt: fallback(receiptDecoder, null) });

/** One press applies: the acknowledgement of unchecked changes rides on it when the card asked for it. */
export function approvePlan(planId: string, acknowledge: boolean, done: (result: ApplyResult) => void): void {
  const args: JsonObject = acknowledge ? { planId, waitSeconds: APPLY_WAIT_SECONDS, acknowledgeUnverified: true } : { planId, waitSeconds: APPLY_WAIT_SECONDS };
  mcpCall({ name: "ae_approve_plan", args, data: approveDataDecoder, timeoutMs: APPLY_REQUEST_TIMEOUT_MS }, (reply) => {
    if (!reply.ok) {
      const needsAcknowledgement = !acknowledge && reply.error.code === "UNVERIFIED_OPERATIONS";
      done(needsAcknowledgement ? { kind: "needs-acknowledgement" } : { kind: "refused", message: reply.error.reason || t("plans.action.notAccepted") });
      return;
    }
    const { status, receipt } = reply.value;
    if (receipt) recordReceipt(planId, receipt);
    setPlanStatus(planId, status);
    done({ kind: status === "approved" || status === "applying" ? "queued" : "done", status });
  });
}

/** Discards the plan; `done` receives the problem, or null when it is discarded. */
export function discardPlan(planId: string, done: (problem: string | null) => void): void {
  mcpCall({ name: "ae_cancel_plan", args: { planId }, data: ignored }, (reply) => {
    if (!reply.ok) {
      done(reply.error.reason || t("plans.action.discardFailed"));
      return;
    }
    setPlanStatus(planId, "cancelled");
    done(null);
  });
}

/** Undoes the plan's changes; `done` receives the problem, or null with what the undo did. */
export function undoPlan(planId: string, scope: "all" | "last", done: (problem: string | null, outcome?: UndoOutcome) => void): void {
  mcpCall({ name: "ae_undo_plan", args: { planId, scope, waitSeconds: UNDO_WAIT_SECONDS }, data: undoDataDecoder, timeoutMs: UNDO_REQUEST_TIMEOUT_MS }, (reply) => {
    if (!reply.ok) {
      done(reply.error.reason || t("plans.action.undoFailed"));
      return;
    }
    const outcome = undoOutcome(reply.value);
    if (outcome.status) setPlanStatus(planId, outcome.status);
    done(outcome.problem, outcome);
  });
}

/** The full receipt for the clipboard; the card never shows it. */
export function fetchReceiptText(planId: string, done: (text: string | null) => void): void {
  mcpCall({ name: "ae_get_receipt", args: { planId }, data: jsonValue }, (reply) => {
    done(reply.ok ? JSON.stringify(reply.value, null, 2) : null);
  });
}

/** Puts the text on the clipboard; false when nothing could. */
export function copyText(text: string): boolean {
  try {
    if (window.navigator && window.navigator.clipboard && typeof window.navigator.clipboard.writeText === "function") {
      void window.navigator.clipboard.writeText(text);
      return true;
    }
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const copied = !!(document.execCommand && document.execCommand("copy"));
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}

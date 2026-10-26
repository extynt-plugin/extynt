/** What an Undo press actually did, read from the undo tool's answer rather than from its ok, which only says the request was accepted. */
import { boolean, fallback, object, optional, string } from "@extynt/decode";
import type { Infer } from "@extynt/decode";

interface UndoOutcome {
  problem: string | null;
  text: string;
  status: string | null;
}

const failureBody = object({ message: optional(fallback(string(), undefined)) });
const receiptBody = object({ status: optional(fallback(string(), undefined)), hostError: optional(fallback(failureBody, undefined)), error: optional(fallback(failureBody, undefined)) });
const undoAnswer = object({ data: optional(fallback(object({ status: optional(fallback(string(), undefined)), workflowRefused: optional(fallback(boolean(), undefined)), receipt: optional(fallback(receiptBody, undefined)) }), undefined)) });

type UndoAnswer = Infer<typeof undoAnswer>;

/** The host undoes with Edit > Undo, which takes back the newest change: after any later change it would take back that one instead. */
export const UNDO_CHANGED_TEXT = "After Effects recorded changes after the agent's edit, so Edit > Undo would take those back first. Nothing was undone; use Edit > Undo in After Effects yourself if you want to step back.";

const REQUESTED: UndoOutcome = { problem: null, text: "Undo is queued; it runs as soon as After Effects is free.", status: "undo_requested" };
const REFUSED: UndoOutcome = { problem: "Not undone: this plan's undo was refused before After Effects was asked (an undo may already be pending). Use Edit > Undo in After Effects if you need to go back.", text: "", status: null };
const FALLBACK: UndoOutcome = { problem: null, text: "Undo requested.", status: "undo_requested" };
const BY_STATUS: ReadonlyMap<string, UndoOutcome> = new Map([
  ["undo_requested", REQUESTED],
  ["undone", { problem: null, text: "Undone.", status: "undone" }],
  ["partially_undone", { problem: null, text: "Last step undone.", status: "partially_undone" }],
  ["undo_unverified", { problem: "Undo ran, but the project does not match its state before this plan; check it in After Effects.", text: "", status: "undo_unverified" }],
]);
const RECEIPT_PROBLEM: ReadonlyMap<string, string> = new Map([
  ["rejected", "Not undone: "],
  ["unknown", "Undo outcome is unknown: "],
]);

function reasonOf(receipt: NonNullable<NonNullable<UndoAnswer["data"]>["receipt"]>): string {
  return (receipt.hostError ?? receipt.error)?.message || "no reason was given";
}

function receiptProblem(receipt: NonNullable<NonNullable<UndoAnswer["data"]>["receipt"]>): UndoOutcome | null {
  const lead = RECEIPT_PROBLEM.get(receipt.status ?? "");
  return lead ? { problem: lead + reasonOf(receipt), text: "", status: null } : null;
}

/** The problem, text and status an undo answer amounts to. */
export function undoOutcome(answer: UndoAnswer): UndoOutcome {
  const data = answer.data ?? {};
  if (data.workflowRefused === true) return REFUSED;
  if (data.status === "undo_requested") return REQUESTED;
  return receiptProblem(data.receipt ?? {}) ?? BY_STATUS.get(data.status ?? "") ?? FALLBACK;
}

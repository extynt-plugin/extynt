// Keeps the receipt ledger bounded and remembers the meaning of an undo receipt.
import type { StoredPlan, StoredReceipt } from "@extynt/mcp-server";

type SemanticPlan = StoredPlan & { undoReceiptSemantic?: string };

const MAX_STORED_RECEIPTS = 50;

/** Adds a receipt to the ledger, dropping the oldest beyond the bound. */
export function keepReceipt(ledger: StoredReceipt[], receipt: StoredReceipt): void {
  ledger.push(receipt);
  while (ledger.length > MAX_STORED_RECEIPTS) ledger.shift();
}

/** The same plan record seen as one that can remember the meaning of its undo receipt. */
export function withUndoSemantic(record: StoredPlan): SemanticPlan {
  return record;
}

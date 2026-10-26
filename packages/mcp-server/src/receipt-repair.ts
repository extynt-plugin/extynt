// The instructions the model reads when a batch was rolled back or applied without reading back as asked.
import { arrayAt, numberAt, objectAt, stringAt } from "./json.js";
import { isJsonObject } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { ROLLED_BACK_STATE, hostErrorOf } from "./receipts.js";

/** One operation that applied but did not read back as asked, as the repair instruction names it. */
export interface ReadbackMismatch {
  readonly index: number;
  readonly type: string;
  readonly where?: string | undefined;
  readonly basis?: string | undefined;
  readonly expected?: JsonValue | undefined;
  readonly observed?: JsonValue | undefined;
}

const MISMATCHES_NAMED = 6;
const TARGET_LABELS = [["layer", "layerId"], ["composition", "compositionId"], ["item", "itemId"], ["property", "propertyPath"], ["effect", "effectPath"]] as const;

function singleLine(text: string, limit: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

function targetWords(targets: JsonObject | undefined): string {
  return TARGET_LABELS.flatMap(([label, field]) => {
    const value = stringAt(targets, field);
    return value ? [`${label} ${value}`] : [];
  }).join(", ");
}

function outcomeRows(receipt: JsonObject): ReadonlyArray<JsonObject | undefined> {
  return (arrayAt(receipt, "operationOutcomes") ?? []).map((row) => (isJsonObject(row) ? row : undefined));
}

function failedOperationWords(failure: JsonObject | undefined, rows: ReadonlyArray<JsonObject | undefined>, index: number): string {
  if (index < 0) return "an operation";
  const row = rows[index];
  const type = stringAt(row, "type") ?? stringAt(failure, "operation");
  const where = targetWords(objectAt(row, "targets"));
  const total = rows.length ? ` of ${rows.length}` : "";
  const detail = type ? ` (${type}${where ? ` on ${where}` : ""})` : "";
  return `operation ${index + 1}${total}${detail}`;
}

/**
 * What the model (or an MCP client) reads when After Effects rejected one operation of a batch and rolled the whole batch back: which
 * operation by its own position, type and target, After Effects' own message, and that nothing was applied. Undefined for any other receipt.
 */
export function rolledBackCorrection(receipt: JsonObject): string | undefined {
  if (stringAt(receipt, "mutationState") !== ROLLED_BACK_STATE) return undefined;
  const failure = objectAt(receipt, "failure");
  const reported = numberAt(failure, "operationIndex");
  const which = failedOperationWords(failure, outcomeRows(receipt), reported !== undefined && reported >= 0 ? reported : -1);
  const message = hostErrorOf(receipt)?.message ?? "no message";
  return `After Effects rejected ${which}: ${singleLine(message, 400)} The whole batch was rolled back, so nothing from this batch was applied and the project is as before it. Resend the whole batch corrected, changing only what this error names.`;
}

function valueWords(value: JsonValue | undefined): string {
  if (value === undefined) return "unknown";
  return singleLine(typeof value === "string" ? value : JSON.stringify(value), 60);
}

function mismatchWords(mismatch: ReadbackMismatch): string {
  const compared = mismatch.expected !== undefined || mismatch.observed !== undefined ? `expected ${valueWords(mismatch.expected)}, observed ${valueWords(mismatch.observed)}` : undefined;
  const detail = [mismatch.basis, compared].filter(Boolean).join(": ");
  return `operation ${mismatch.index + 1} (${mismatch.type}${mismatch.where ? ` on ${mismatch.where}` : ""}${detail ? `; ${detail}` : ""})`;
}

/**
 * What the model (or an MCP client) reads when a batch applied but some operations did not read back as asked: which operations by
 * position, type and target with expected against observed where known, that the rest of the batch stands, and what to send.
 */
export function readbackRepairText(total: number, mismatches: ReadonlyArray<ReadbackMismatch>): string | undefined {
  if (!mismatches.length) return undefined;
  const named = mismatches.slice(0, MISMATCHES_NAMED).map(mismatchWords).join("; ");
  const more = mismatches.length - MISMATCHES_NAMED;
  const count = `${mismatches.length}${total ? ` of ${total}` : ""} ${mismatches.length === 1 ? "operation" : "operations"}`;
  return `After Effects applied the batch, but ${count} did not read back as requested: ${named}${more > 0 ? `; and ${more} more` : ""}. The rest of the batch stands, so do not resend it. Queue only corrected versions of ${mismatches.length === 1 ? "that operation" : "those operations"} with ae_queue_add and ae_queue_finish; if the observed value already meets the request, say so in your answer instead.`;
}

/** The same instruction from a stored receipt's per-operation outcomes (the MCP receipt view). */
export function readbackRepairCorrection(receipt: JsonObject): string | undefined {
  const rows = outcomeRows(receipt);
  const mismatches = rows.flatMap((row, position): ReadbackMismatch[] => {
    if (!row || row.outcome !== "readback_mismatch") return [];
    const readBack = objectAt(row, "readBack");
    return [{
      index: numberAt(row, "index") ?? position,
      type: stringAt(row, "type") ?? "operation",
      where: targetWords(objectAt(row, "targets")) || undefined,
      basis: stringAt(row, "basis"),
      expected: readBack?.expectedValue,
      observed: readBack?.observedValue,
    }];
  });
  return readbackRepairText(rows.length, mismatches);
}

// Why a verification failed, read from a receipt: a count and one bounded line that groups the failed operations by basis and field, never a list.
import { array, decode, fallback, jsonValueWithin, map, number, object, string } from "@extynt/decode";
import type { Decoder, Infer, JsonValue } from "@extynt/decode";
import { PROPOSAL_OPERATION_LIMIT } from "./core-constants.js";
import type { StoredReceipt } from "./stored-receipt.js";

const MAX_FAILURE_BASIS_CHARS = 160;
const MAX_FAILURE_GROUPS = 3;
const BASIS_CHARS = 64;
const FIELD_CHARS = 64;

const slot: Decoder<JsonValue | undefined> = fallback(jsonValueWithin(1), undefined);

const failureRowShape = object({
  basis: fallback(string(), undefined),
  verificationState: fallback(string(), undefined),
  field: slot,
  option: slot,
  setting: slot,
  attribute: slot,
  propertyPath: slot,
});

type FailureRow = Infer<typeof failureRowShape>;

const failureRows: Decoder<FailureRow[]> = map(array(fallback(failureRowShape, undefined)), (rows) => rows.filter((row): row is FailureRow => row !== undefined));

const receiptEvidence = object({
  repair: fallback(object({ failedCount: fallback(number(), undefined), operations: fallback(failureRows, undefined) }), undefined),
  verification: fallback(object({ steps: fallback(failureRows, undefined) }), undefined),
});

interface VerificationFailure {
  readonly failedOperations: number;
  readonly failureBasis: string;
}

function fieldOf(row: FailureRow): string | null {
  const field = row.field ?? row.option ?? row.setting ?? row.attribute ?? row.propertyPath;
  return typeof field === "string" && field ? field.slice(0, FIELD_CHARS) : null;
}

function labelled(row: FailureRow): string {
  const basis = row.basis ? row.basis.slice(0, BASIS_CHARS) : "unknown";
  const field = fieldOf(row);
  return field ? `${basis} (${field})` : basis;
}

function failureSummary(rows: readonly FailureRow[], failedOperations: number): string {
  const grouped = new Map<string, number>();
  for (const row of rows) grouped.set(labelled(row), (grouped.get(labelled(row)) ?? 0) + 1);
  const ordered = [...grouped].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, MAX_FAILURE_GROUPS);
  const shown = ordered.reduce((sum, [, count]) => sum + count, 0);
  return `${ordered.map(([label, count]) => (count > 1 ? `${label} ×${count}` : label)).join("; ")}${failedOperations > shown ? `; +${failedOperations - shown} more` : ""}`;
}

function reportedFailures(count: number | undefined): number {
  return count !== undefined && Number.isFinite(count) && count >= 1 ? Math.min(PROPOSAL_OPERATION_LIMIT, Math.floor(count)) : 0;
}

function failureLine(rows: readonly FailureRow[], failedOperations: number): string {
  const line = failureSummary(rows, failedOperations);
  return line.length > MAX_FAILURE_BASIS_CHARS ? `${line.slice(0, MAX_FAILURE_BASIS_CHARS - 1)}…` : line;
}

function failedRows(evidence: Infer<typeof receiptEvidence>): readonly FailureRow[] {
  const repaired = evidence.repair?.operations ?? [];
  return repaired.length ? repaired : (evidence.verification?.steps ?? []).filter((step) => step.verificationState === "failed");
}

/** Why the receipt's read-back failed, from the host's repair packet or else its failed verification steps; nothing when the receipt names no failed operation. */
export function verificationFailure(receipt: StoredReceipt | undefined): VerificationFailure | undefined {
  const decoded = decode(receiptEvidence, receipt);
  if (!decoded.ok) return undefined;
  const rows = failedRows(decoded.value);
  if (!rows.length) return undefined;
  const failedOperations = Math.max(rows.length, reportedFailures(decoded.value.repair?.failedCount));
  return { failedOperations, failureBasis: failureLine(rows, failedOperations) };
}

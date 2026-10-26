// Re-bounds the failure, verification and repair evidence a panel reports.
import { array, decode, fallback, type Infer, type JsonObject, jsonValue, type JsonValue, number, object, string } from "@extynt/decode";
import { PROPOSAL_OPERATION_LIMIT } from "@extynt/mcp-server";

import { MAX_REPAIR_OPERATIONS } from "./server-limits.js";

const OPERATION_CHARS = 64;
const REPAIR_TEXT_LIMITS = { operation: 64, basis: 96, field: 160, expected: 200, observed: 200, compositionId: 64, layerId: 64 } as const;

const failureShape = object({ phase: fallback(string(), undefined), operationIndex: fallback(number(), undefined), operation: fallback(string(), undefined) });

function failureIndex(value: number | undefined): number | null {
  return value !== undefined && Number.isInteger(value) && value >= -1 && value < PROPOSAL_OPERATION_LIMIT ? value : null;
}

/** The failure a panel reported, reduced to its phase, operation index and operation name; absent when it is not an object. */
export function boundedFailure(value: JsonValue | undefined): JsonObject | undefined {
  const decoded = decode(failureShape, value);
  if (!decoded.ok) return undefined;
  const failure = decoded.value;
  const phase = failure.phase === "apply" || failure.phase === "preflight" ? failure.phase : "unknown";
  return { phase, operationIndex: failureIndex(failure.operationIndex), operation: failure.operation === undefined ? null : failure.operation.slice(0, OPERATION_CHARS) };
}

/** The verification a panel reported with its steps held to one per plan operation. */
export function boundedVerification(verification: JsonObject): JsonObject {
  const steps = decode(array(jsonValue), verification.steps);
  return steps.ok ? { ...verification, steps: steps.value.slice(0, PROPOSAL_OPERATION_LIMIT) } : verification;
}

function validCount(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

const repairEntryShape = object({
  index: fallback(number(), undefined),
  operation: fallback(string(), undefined),
  basis: fallback(string(), undefined),
  field: fallback(string(), undefined),
  expected: fallback(string(), undefined),
  observed: fallback(string(), undefined),
  compositionId: fallback(string(), undefined),
  layerId: fallback(string(), undefined),
});

function repairEntry(entry: Infer<typeof repairEntryShape>): JsonObject {
  const bounded: { [key: string]: JsonValue } = {};
  if (validCount(entry.index)) bounded.index = Math.floor(entry.index);
  for (const key of ["operation", "basis", "field", "expected", "observed", "compositionId", "layerId"] as const) {
    const text = entry[key];
    if (text !== undefined) bounded[key] = text.slice(0, REPAIR_TEXT_LIMITS[key]);
  }
  return bounded;
}

const repairPacketShape = object({ failedCount: fallback(number(), undefined), operations: fallback(array(jsonValue), undefined) });

function repairRows(rows: readonly JsonValue[]): JsonObject[] {
  const bounded: JsonObject[] = [];
  for (const row of rows.slice(0, MAX_REPAIR_OPERATIONS)) {
    const decoded = decode(repairEntryShape, row);
    if (decoded.ok) bounded.push(repairEntry(decoded.value));
  }
  return bounded;
}

/** The panel's repair packet, re-bounded on this side of the wire. */
export function boundedRepair(value: JsonValue | undefined): { failedCount: number; operations: JsonObject[] } | undefined {
  const decoded = decode(repairPacketShape, value);
  if (!decoded.ok) return undefined;
  const failedCount = validCount(decoded.value.failedCount) ? Math.min(PROPOSAL_OPERATION_LIMIT, Math.floor(decoded.value.failedCount)) : 0;
  const operations = repairRows(decoded.value.operations ?? []);
  return failedCount > 0 || operations.length ? { failedCount, operations } : undefined;
}

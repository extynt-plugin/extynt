// The wire form of a receipt: the decoder that admits it and the bounded readings of its fields that the stored receipt is built from.
import { type Decoder, isJsonObject, type JsonObject, type JsonValue, jsonValueWithin, map, refine, skippingInvalidRecord } from "@extynt/decode";
import { PROPOSAL_OPERATION_LIMIT } from "@extynt/mcp-server";

const WIRE_NESTING = 32;
const OPERATION_CHARS = 64;
const EXTERNAL_OUTPUT_LIMIT = 16;
const CREATED_BINDING_LIMIT = 256;
const MAX_HOST_HOP_MS = 600_000;
const RECEIPT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const BINDING_KEY_PATTERN = /^__new__:[A-Za-z0-9._-]{1,128}$/;

type ReceiptWire = { readonly [field: string]: JsonValue | undefined };

/** A receipt that names its plan and its status, with the fields every admission decision reads. */
export type ReceiptHead = {
  readonly wire: ReceiptWire;
  readonly planId: string;
  readonly status: string;
  readonly operation: string | undefined;
  readonly postcondition: string | undefined;
  readonly mayHaveMutated: boolean;
  readonly approvalId: JsonValue | undefined;
  readonly receiptId: string | null;
};

type NamedWire = ReceiptWire & { readonly planId: string; readonly status: string };

function namesPlanAndStatus(wire: ReceiptWire): wire is NamedWire {
  return typeof wire.planId === "string" && typeof wire.status === "string";
}

function present(row: JsonObject | undefined): row is JsonObject {
  return row !== undefined;
}

function textOf(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function headOf(wire: NamedWire): ReceiptHead {
  const receiptId = textOf(wire.receiptId);
  return {
    wire,
    planId: wire.planId,
    status: wire.status,
    operation: textOf(wire.operation),
    postcondition: textOf(wire.postcondition),
    mayHaveMutated: wire.mayHaveMutated === true,
    approvalId: wire.approvalId,
    receiptId: receiptId !== undefined && RECEIPT_ID_PATTERN.test(receiptId) ? receiptId : null,
  };
}

/** Accepts a receipt body that names its plan and its status. */
export const receiptHead: Decoder<ReceiptHead> = map(
  refine(skippingInvalidRecord(jsonValueWithin(WIRE_NESTING)), namesPlanAndStatus, "a receipt with a plan id and a status"),
  headOf,
);

/** The text, cut to the bound; the fallback when the field is not text. */
export function boundedText<Fallback extends string | null>(value: JsonValue | undefined, maximum: number, fallback: Fallback): string | Fallback {
  return typeof value === "string" ? value.slice(0, maximum) : fallback;
}

/** The whole number from one up to the maximum; absent when the field is not a number of at least one. */
export function boundedCount(value: JsonValue | undefined, maximum: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.min(maximum, Math.floor(value)) : undefined;
}

/** A host hop duration in whole milliseconds, held to ten minutes. */
export function hostHopMs(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(MAX_HOST_HOP_MS, Math.floor(value)) : undefined;
}

function entriesOf(value: JsonValue | undefined): readonly JsonValue[] | undefined {
  return Array.isArray(value) ? value.map((entry: JsonValue) => entry) : undefined;
}

/** The operation names a receipt lists, one bounded name each. */
export function boundedOperations(value: JsonValue | undefined): string[] | undefined {
  return entriesOf(value)?.slice(0, PROPOSAL_OPERATION_LIMIT).map((entry) => boundedText(entry, OPERATION_CHARS, "unknown"));
}

function externalOutput(entry: JsonValue): { path: string; operation: string } | undefined {
  if (!isJsonObject(entry) || typeof entry.path !== "string") return undefined;
  return { path: entry.path.slice(0, 1024), operation: boundedText(entry.operation, OPERATION_CHARS, "unknown") };
}

/** Files a plan wrote outside the project (renders, saves, exports), bounded so a receipt cannot grow without limit. */
export function boundedExternalOutputs(value: JsonValue | undefined): Array<{ path: string; operation: string }> | undefined {
  const entries = entriesOf(value);
  if (!entries) return undefined;
  const rows: Array<{ path: string; operation: string }> = [];
  for (const entry of entries) {
    if (rows.length >= EXTERNAL_OUTPUT_LIMIT) break;
    const row = externalOutput(entry);
    if (row) rows.push(row);
  }
  return rows;
}

function managedSource(entry: JsonValue): JsonObject | undefined {
  if (!isJsonObject(entry)) return undefined;
  return {
    ...(typeof entry.sourceHash === "string" ? { sourceHash: entry.sourceHash.slice(0, 128) } : {}),
    ...(typeof entry.bytes === "number" && Number.isFinite(entry.bytes) ? { bytes: entry.bytes } : {}),
    ...(typeof entry.policy === "string" ? { policy: entry.policy.slice(0, 32) } : {}),
    ...(typeof entry.reused === "boolean" ? { reused: entry.reused } : {}),
    ...(typeof entry.persistsAfterUndo === "boolean" ? { persistsAfterUndo: entry.persistsAfterUndo } : {}),
  };
}

/** Managed SVG sources the plan retained on disk: only the identifying fields are kept. */
export function boundedManagedSources(value: JsonValue | undefined): JsonObject[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, EXTERNAL_OUTPUT_LIMIT).map(managedSource).filter(present);
}

function keyframeStep(step: JsonValue): JsonObject | undefined {
  if (!isJsonObject(step)) return undefined;
  return {
    propertyPath: String(step.propertyPath ?? "").slice(0, 256),
    keyframeMode: typeof step.keyframeMode === "string" ? step.keyframeMode.slice(0, 16) : null,
    removedKeys: typeof step.removedKeys === "number" ? step.removedKeys : 0,
    afterKeys: typeof step.afterKeys === "number" ? step.afterKeys : null,
  };
}

/** The keyframe steps a receipt reports, one bounded row per plan operation at most. */
export function boundedKeyframeSteps(value: JsonValue | undefined): JsonObject[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, PROPOSAL_OPERATION_LIMIT).map(keyframeStep).filter(present);
}

/** The ids the host gave the layers a plan created, keyed by the plan's `__new__` names. */
export function boundedCreatedBindings(value: JsonValue | undefined): JsonObject | undefined {
  if (value === undefined || !isJsonObject(value)) return undefined;
  const entries = Object.entries(value).filter(([key, entry]) => BINDING_KEY_PATTERN.test(key) && (typeof entry === "string" || typeof entry === "number"));
  return Object.fromEntries(entries.slice(0, CREATED_BINDING_LIMIT).map(([key, entry]) => [key, String(entry).slice(0, OPERATION_CHARS)]));
}

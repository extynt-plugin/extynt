/**
 * What the host's apply entry (`aeApplyPlan`) answers for the fixture host: the fixture applies the operations, and this module
 * turns the verdicts into the JSON the jsx returns (`ok`, `steps`, `undoGroups`, or the failure members the sidecar's receipts read).
 */
import { CANONICAL_PREFIX } from "./fake-host-tables.js";
import type { FixtureApplyResult, FixtureOperationVerdict } from "./fake-host.js";
import type { WireObject, WireValue } from "./wire-types.js";

/**
 * How the fake plugin answers an apply: `verified` is the honest answer, and the sidecar verifies it against the fixture's own read-back.
 * The others make the host misbehave in one named way: `unreadable` applies but cannot read the project back, `unknown` answers with
 * something that is not JSON, `rejected` refuses before changing anything, `partial` changes the project and reports a failure, and
 * `lost` applies and then drops the connection without answering.
 */
export type ReceiptMode = "verified" | "unreadable" | "unknown" | "rejected" | "partial" | "lost";

/** One batch the fake plugin applied, kept so a run can report what the project actually received. */
export interface AppliedBatch {
  planId: string;
  operations: number;
  applied: number;
  refused: Array<{ index: number; type: string; code: string; message: string }>;
  mutated: boolean;
}

interface Declaration { field: string; requested: string; real: string }
const FOLDER: Declaration[] = [{ field: "newFolderId", requested: "requestedFolderId", real: "folderId" }];
const ITEM: Declaration[] = [{ field: "newItemId", requested: "requestedItemId", real: "itemId" }];
const NEW_LAYER: Declaration = { field: "newLayerId", requested: "requestedLayerId", real: "layerId" };

const DECLARATIONS: Readonly<Record<string, readonly Declaration[]>> = {
  create_composition: [{ field: "newCompositionId", requested: "requestedCompositionId", real: "compositionId" }],
  precompose_layers: [{ field: "newCompositionId", requested: "requestedNewCompositionId", real: "newCompositionId" }, NEW_LAYER],
  duplicate_layer: [NEW_LAYER],
  create_folder: FOLDER,
  import_file: ITEM,
  create_vector_artwork: ITEM,
  add_mask: [{ field: "newMaskId", requested: "requestedMaskId", real: "maskId" }],
  create_shape_group: [{ field: "newGroupId", requested: "requestedGroupId", real: "groupId" }],
};

const isPlaceholder = (value: WireValue | undefined): value is string => typeof value === "string" && value.startsWith(CANONICAL_PREFIX);

function typeOf(operation: WireObject): string {
  const type = operation.operation ?? operation.type;
  return typeof type === "string" ? type : "unknown";
}

function declaredIds(operation: WireObject, bindings: Readonly<Record<string, string>>): WireObject {
  const step: Record<string, WireValue> = {};
  for (const declaration of DECLARATIONS[typeOf(operation)] ?? []) {
    const placeholder = operation[declaration.field];
    if (!isPlaceholder(placeholder)) continue;
    step[declaration.requested] = placeholder;
    step[declaration.real] = bindings[placeholder] ?? placeholder;
  }
  return step;
}

function stepOf(operation: WireObject, bindings: Readonly<Record<string, string>>): WireObject {
  const compositionId = operation.compositionId, layerId = operation.layerId;
  return {
    operation: typeOf(operation),
    ...(typeof compositionId === "string" ? { compositionId: bindings[compositionId] ?? compositionId } : {}),
    ...(typeof layerId === "string" ? { layerId: bindings[layerId] ?? layerId, ...(isPlaceholder(layerId) ? { requestedLayerId: layerId } : {}) } : {}),
    ...declaredIds(operation, bindings),
  };
}

function verdictRow(verdict: FixtureOperationVerdict): AppliedBatch["refused"][number] {
  return { index: verdict.index, type: verdict.type, code: verdict.code ?? "REFUSED", message: verdict.message ?? "" };
}

/** The record of a batch the fixture applied, with the operations it refused. */
export function batchOf(planId: string, operations: number, result: FixtureApplyResult): AppliedBatch {
  const refused = result.verdicts.filter((verdict) => !verdict.ok).map(verdictRow);
  return { planId, operations, applied: result.verdicts.length - refused.length, refused, mutated: result.mutated };
}

/** The record of a batch refused before anything was applied. */
export function refusedBatch(planId: string, operations: readonly WireObject[], refusal: { code: string; message: string }): AppliedBatch {
  return {
    planId,
    operations: operations.length,
    applied: 0,
    refused: operations.map((operation, index) => ({ index, type: typeOf(operation), ...refusal })),
    mutated: false,
  };
}

/** The batch size the request asked for; without one the jsx keeps the whole plan in a single undo group. */
export function batchSizeOf(args: WireObject): number | undefined {
  const size = args.batchSize;
  return typeof size === "number" && size >= 1 ? Math.floor(size) : undefined;
}

function stepsOf(operations: readonly WireObject[], result: FixtureApplyResult): WireObject[] {
  const bindings = result.bindings;
  return result.verdicts.flatMap((verdict) =>
    verdict.ok && operations[verdict.index] !== undefined
      ? [{ ...stepOf(operations[verdict.index] ?? {}, bindings), ...result.evidence.get(verdict.index) }]
      : [],
  );
}

/** The jsx's answer when it ran the plan: all operations applied, or the first refusal with what was applied before it. */
export function appliedAnswer(operations: readonly WireObject[], result: FixtureApplyResult, batchSize?: number): WireObject {
  const steps = stepsOf(operations, result), refused = result.verdicts.find((verdict) => !verdict.ok);
  if (!refused) return { ok: true, steps, undoGroups: batchSize ? Math.max(1, Math.ceil(steps.length / batchSize)) : 1, ...(batchSize ? { batchSize } : {}) };
  return {
    ok: false, mayHaveMutated: result.mutated, mutationState: result.mutated ? "partial-applied" : "not-applied", phase: "apply", steps,
    failedOperationIndex: refused.index, failedOperation: refused.type, error: { code: refused.code ?? "REFUSED", message: refused.message ?? "The fixture refused the operation." },
  };
}

/** The jsx's answer for a host that refuses before changing anything. */
export function rejectedAnswer(code: string, message: string): WireObject {
  return { ok: false, mayHaveMutated: false, mutationState: "not-applied", phase: "preflight", error: { code, message } };
}

/** The jsx's answer for a host that changed the project and then failed: the receipt must say mutation may have happened. */
export function partialAnswer(operations: readonly WireObject[], result: FixtureApplyResult): WireObject {
  const steps = stepsOf(operations, result), last = Math.max(0, steps.length - 1);
  return {
    ok: false, mayHaveMutated: true, mutationState: "partial-applied", phase: "apply", steps, failedOperationIndex: last, failedOperation: typeOf(operations[last] ?? {}),
    error: { code: "FIXTURE_PARTIAL", message: "The fixture host stopped part-way through the plan." },
  };
}

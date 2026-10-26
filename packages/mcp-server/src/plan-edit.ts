// One index-addressed edit of a plan's operations: reading the edit, binding the operation it writes, and applying it to the list.
import type { ActionPlanV2Operation } from "@extynt/action-plan";
import type { ProjectSnapshot } from "@extynt/project-graph";
import { asObject, integerAt, nonEmptyStringAt, objectAt, stringAt } from "./json.js";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { normalizeTextLineBreaks, fieldsOf } from "./operation-fields.js";
import { operationJson, operationOf } from "./operations.js";
import { rebindPlaceholders } from "./placeholder-rebind.js";
import { toolError } from "./tool-result.js";
import type { ToolFailure } from "./tool-result.js";

/** The operations being edited and the caller's own spelling of each, kept in step. */
export interface EditState {
  operations: ActionPlanV2Operation[];
  authored: JsonValue[];
}

interface EditScope {
  readonly snapshot: ProjectSnapshot;
  readonly bindings: Readonly<Record<string, string>>;
}

type EditOp = "replace" | "remove" | "insert";
type Checked<T> = { readonly value: T } | ToolFailure;

function editOp(position: number, edit: JsonObject): Checked<EditOp> {
  const op = stringAt(edit, "op");
  if (op === "replace" || op === "remove" || op === "insert") return { value: op };
  return toolError("INVALID_ARGUMENT", `Edit ${position} has op ${JSON.stringify(edit.op)}; use "replace", "remove", or "insert".`);
}

function editIndex(position: number, edit: JsonObject, length: number, op: EditOp): Checked<number> {
  const index = integerAt(edit, "index");
  if (index === undefined || index < 0) return toolError("INVALID_ARGUMENT", `Edit ${position} needs a non-negative integer index.`);
  const shifted = position > 0 ? " Earlier edits in this call already shifted the indexes; list removals highest index first so each index still names the operation you read." : "";
  if (index > length || (op !== "insert" && index >= length)) return toolError("INVALID_ARGUMENT", `Edit ${position} addresses operation #${index}, but the plan now has ${length} operation(s) (0-${Math.max(0, length - 1)}). Use indexes that exist.${shifted}`);
  return { value: index };
}

function onLayer(operation: ActionPlanV2Operation, layerId: string): boolean {
  const written = operationJson(operation);
  return stringAt(objectAt(written, "target"), "layerId") === layerId || stringAt(written, "newLayerId") === layerId;
}

function editCandidates(operations: readonly ActionPlanV2Operation[], replaced: number, layerId: string | undefined): ActionPlanV2Operation[] {
  const previous = operations[replaced];
  const sameLayer = layerId ? operations.filter((operation) => onLayer(operation, layerId)) : [];
  return previous && (!layerId || onLayer(previous, layerId)) ? [previous, ...sameLayer] : sameLayer;
}

function editComposition(operations: readonly ActionPlanV2Operation[], replaced: number, layerId: string | undefined, snapshot: ProjectSnapshot): string | undefined {
  const inherited = editCandidates(operations, replaced, layerId).map((operation) => nonEmptyStringAt(objectAt(operationJson(operation), "target"), "compositionId")).find(Boolean);
  if (inherited) return inherited;
  const owner = layerId ? snapshot.compositions.find((composition) => composition.layers.some((layer) => layer.id === layerId)) : undefined;
  return owner?.id ?? (snapshot.activeCompositionId || undefined);
}

function targetedWith(target: JsonObject, compositionId: string | undefined, snapshot: ProjectSnapshot): JsonObject {
  return { ...target, ...(compositionId ? { compositionId } : {}), snapshotFingerprint: snapshot.fingerprint, selectionFingerprint: snapshot.selectionFingerprint };
}

type WrittenOperation = { written: JsonValue; rebound: ActionPlanV2Operation };

function editedOperation(value: JsonValue | undefined, scope: EditScope, impliedComposition: (layerId: string | undefined) => string | undefined): WrittenOperation | undefined {
  const candidate = fieldsOf(value);
  if (!candidate) return undefined;
  const written = structuredClone(asObject(value) ?? {});
  normalizeTextLineBreaks(candidate);
  const target = objectAt(candidate, "target");
  const layerId = stringAt(target, "layerId");
  const compositionId = nonEmptyStringAt(target, "compositionId") ?? impliedComposition(layerId === undefined ? undefined : (scope.bindings[layerId] ?? layerId));
  const bound = target ? { ...candidate, target: targetedWith(target, compositionId, scope.snapshot) } : candidate;
  const rebound = operationOf(rebindPlaceholders(bound, scope.bindings));
  return rebound && { written, rebound };
}

function writeEdit(state: EditState, op: "replace" | "insert", index: number, entry: WrittenOperation): void {
  state.operations.splice(index, op === "replace" ? 1 : 0, entry.rebound);
  state.authored.splice(index, op === "replace" ? 1 : 0, entry.written);
}

function applyEdit(state: EditState, edit: JsonObject, position: number, scope: EditScope): ToolFailure | undefined {
  const op = editOp(position, edit);
  if ("error" in op) return op;
  const index = editIndex(position, edit, state.operations.length, op.value);
  if ("error" in index) return index;
  if (op.value === "remove") {
    state.operations.splice(index.value, 1);
    state.authored.splice(index.value, 1);
    return undefined;
  }
  const replaced = op.value === "replace" ? index.value : -1;
  const entry = editedOperation(edit.operation, scope, (layerId) => editComposition(state.operations, replaced, layerId, scope.snapshot));
  if (!entry) return toolError("INVALID_ARGUMENT", `Edit ${position} (${op.value}) needs an operation object.`);
  writeEdit(state, op.value, index.value, entry);
  return undefined;
}

/** Applies the edits in the order given, each index addressing the list as the earlier edits left it; the first refused edit stops the run. */
export function applyEdits(state: EditState, edits: ReadonlyArray<JsonValue>, scope: EditScope): ToolFailure | undefined {
  for (const [position, edit] of edits.entries()) {
    const failure = applyEdit(state, asObject(edit) ?? {}, position, scope);
    if (failure) return failure;
  }
  return undefined;
}

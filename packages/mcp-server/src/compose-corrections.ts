// Deterministic corrections applied to a caller's operations before they are composed: a field in the wrong
// half of the operation, a near-miss enum spelling, an effect or shape id in a foreign vocabulary. Each fixes
// a refusal whose one correct answer the sidecar already knows, and reports it as a change the caller can read.
import { OPERATION_ENUM_FIELDS, canonicalEnumValue, textEnumMembers } from "@extynt/action-plan";
import type { ActionPlanV2Operation } from "@extynt/action-plan";
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { OperationChange } from "./batch.js";
import { sortDollyKeyframes } from "./compose-camera-corrections.js";
import { recordChange } from "./compose-correction-core.js";
import type { CorrectionContext, CorrectionStep } from "./compose-correction-core.js";
import { dropCurveOnNonNumericKeys, refuseSameTimeKeyframes } from "./compose-curve-corrections.js";
import { supplyDeclarationId } from "./compose-declaration-ids.js";
import { correctEffectOperation } from "./compose-effect-corrections.js";
import { chooseKeyframeMode, confirmOwnedRemoval, dropExpressionRole } from "./compose-intent-corrections.js";
import { dropRedundantTargetCopy, dropTextDocumentPath, expandUniformScale, flattenWrapper, takeTextFromDocument } from "./compose-normalise.js";
import type { Refusal } from "./compose-pass.js";
import { relocateIntoTarget, relocateOutOfTarget } from "./compose-relocation.js";
import { correctShapeOperation } from "./compose-shape-corrections.js";
import { arrayAt, asObject, stringAt } from "./json.js";
import type { JsonArray, JsonValue } from "@extynt/decode";
import { copyFields } from "./operation-fields.js";
import type { OperationFields } from "./operation-fields.js";
import type { PlanProblem } from "./plan-problem.js";

interface EnumSlot {
  readonly holder: OperationFields;
  readonly field: string;
  readonly allowed: readonly string[];
  readonly label: string;
}

function canonicaliseEnum(slot: EnumSlot, context: CorrectionContext): void {
  const { holder, field, label } = slot;
  const canonical = canonicalEnumValue(holder[field], slot.allowed);
  if (canonical === undefined) return;
  recordChange(context, { field: label, from: holder[field], to: canonical, why: `${label} is a closed set; "${String(holder[field])}" names only ${canonical}` });
  holder[field] = canonical;
}

function canonicaliseTextEnums(holder: OperationFields, context: CorrectionContext, labelOf: (field: string) => string): void {
  for (const field of Object.keys(holder)) {
    const allowed = textEnumMembers(field);
    if (allowed) canonicaliseEnum({ holder, field, allowed, label: labelOf(field) }, context);
  }
}

function canonicaliseRange(range: JsonValue, position: number, context: CorrectionContext): JsonValue {
  const fields = asObject(range);
  if (!fields) return range;
  const copy = copyFields(fields);
  canonicaliseTextEnums(copy, context, (field) => `characterRanges[${position}].${field}`);
  return copy;
}

const canonicaliseEnums: CorrectionStep = (operation, context) => {
  for (const [field, allowed] of Object.entries(OPERATION_ENUM_FIELDS[context.type] ?? {})) canonicaliseEnum({ holder: operation, field, allowed, label: field }, context);
  if (context.type !== "set_text_document") return undefined;
  canonicaliseTextEnums(operation, context, (field) => field);
  const ranges = arrayAt(operation, "characterRanges");
  if (ranges) operation.characterRanges = ranges.map((range, position) => canonicaliseRange(range, position, context));
  return undefined;
};

const STEPS: readonly CorrectionStep[] = [
  relocateIntoTarget, dropRedundantTargetCopy, dropTextDocumentPath, relocateOutOfTarget, takeTextFromDocument, expandUniformScale,
  correctEffectOperation, correctShapeOperation, flattenWrapper, sortDollyKeyframes, refuseSameTimeKeyframes, dropCurveOnNonNumericKeys,
  supplyDeclarationId, dropExpressionRole, chooseKeyframeMode, confirmOwnedRemoval, canonicaliseEnums,
];

interface CorrectedOperation {
  operation: JsonValue;
  changes: OperationChange[];
  refusal?: Refusal;
}

interface CorrectionScope {
  call?: JsonArray;
  ownedLayerIds?: ReadonlySet<string>;
}

function contextFor(operation: OperationFields, snapshot: ProjectSnapshot, index: number, scope: CorrectionScope): CorrectionContext {
  const { call, ownedLayerIds } = scope;
  return { snapshot, type: stringAt(operation, "type") ?? "", index, changes: [], ...(call ? { call } : {}), ...(ownedLayerIds ? { ownedLayerIds } : {}) };
}

/** Corrects one caller operation, given its index in the call, the call's other operations as submitted and the real layer ids this same work already created. Returns the copy to compose, what changed, and the refusal when the intent could not be settled (the operation is then left exactly as submitted). The caller's own object is never edited. */
export function correctOperation(raw: JsonValue, snapshot: ProjectSnapshot, index: number, scope: CorrectionScope = {}): CorrectedOperation {
  const submitted = asObject(raw);
  if (!submitted) return { operation: raw, changes: [] };
  const operation = copyFields(submitted);
  const context = contextFor(operation, snapshot, index, scope);
  for (const step of STEPS) {
    const refusal = step(operation, context);
    if (refusal) return { operation: raw, changes: [], refusal };
  }
  return { operation: context.changes.length ? operation : raw, changes: context.changes };
}

/** A correction that refused one operation, addressed by its position in the call. */
export interface OperationRefusal {
  index: number;
  type: string;
  code: string;
  message: string;
}

/** The whole call corrected. An operation whose correction refuses stays as submitted and is listed in `refusals`, so the call's other operations are judged on their own. */
export function correctOperations(raws: JsonArray, snapshot: ProjectSnapshot, ownedLayerIds?: ReadonlySet<string>): { operations: JsonValue[]; changes: OperationChange[][]; refusals: OperationRefusal[] } {
  const corrected = raws.map((raw, index) => correctOperation(raw, snapshot, index, { call: raws, ...(ownedLayerIds ? { ownedLayerIds } : {}) }));
  const refusals = corrected.flatMap((entry, index) => (entry.refusal ? [{ index, type: stringAt(asObject(raws[index]), "type") ?? "unknown", ...entry.refusal }] : []));
  return { operations: corrected.map((entry) => entry.operation), changes: corrected.map((entry) => entry.changes), refusals };
}

function correctionNotes(type: string, changes: readonly OperationChange[]): string[] {
  return changes.map((change) => `Corrected ${type}: ${change.field} ${JSON.stringify(change.from)} -> ${JSON.stringify(change.to)} (${change.why}).`);
}

/** What a tool says about the corrections it applied: how many operations were corrected, and one line per change. */
export function correctionReport(pairs: ReadonlyArray<{ stored: ActionPlanV2Operation; corrections?: readonly OperationChange[] }>): { corrected: number; notes: string[] } {
  const touched = pairs.filter((pair) => pair.corrections?.length);
  return { corrected: touched.length, notes: touched.flatMap((pair) => correctionNotes(pair.stored.type, pair.corrections ?? [])) };
}

/** Plan problems with each correction refusal added as its operation's problem; the refusal names the fix, so it replaces the validator's wording for that operation. */
export function withCorrectionRefusals(problems: readonly PlanProblem[], refusals: readonly OperationRefusal[]): PlanProblem[] {
  const refused = new Set(refusals.map((entry) => entry.index));
  return [...problems.filter((problem) => !refused.has(problem.index)), ...refusals].sort((left, right) => left.index - right.index);
}

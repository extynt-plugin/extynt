// Per-operation outcomes of a stored plan, read from the receipt the host returned.
import { PLAN_TYPE_CONTRACTS } from "@extynt/capability-catalogue";
import type { ActionPlan } from "@extynt/action-plan";
import { arrayAt, booleanAt, numberAt, objectAt, stringAt } from "./json.js";
import type { JsonObject } from "@extynt/decode";
import { operationJson } from "./operations.js";
import { createdIdOf, stepSlotOf, stepsForOperations, targetsFrom } from "./receipt-pairing.js";
import type { OperationSlot, StepSlot, Targets } from "./receipt-pairing.js";
import { coercedEquivalentOf, hostEvidenceOf } from "./receipt-views.js";
import type { OperationOutcome, OperationOutcomeRow, OperationOutcomeSummary } from "./receipt-views.js";

export { COERCION_BASES, HOST_EVIDENCE_RULES, VERIFIED_OUTCOMES, coercedEquivalentOf, hostEvidenceOf, isVerifiedOutcome } from "./receipt-views.js";
export type { OperationOutcome, OperationOutcomeRow, OperationOutcomeSummary } from "./receipt-views.js";

const STEP_FIELDS_ALREADY_ON_THE_ROW: ReadonlySet<string> = new Set(["operation", "compositionId", "layerId", "itemId", "propertyPath", "effectPath", "verificationState", "observed", "basis"]);
const READ_ONLY_TYPES: ReadonlySet<string> = new Set(["read_keyframes"]);
const LAYER_CREATING_TYPES: ReadonlySet<string> = new Set(["duplicate_layer", "derive_layer", "precompose_layers"]);

type Created = Readonly<Record<string, string>>;
interface HostError { readonly code: string; readonly message: string }

function readBackOf(step: JsonObject | undefined): JsonObject | undefined {
  if (!step) return undefined;
  const kept = Object.entries(step).filter(([field]) => !STEP_FIELDS_ALREADY_ON_THE_ROW.has(field));
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}

function targetOf(operation: JsonObject): JsonObject {
  return objectAt(operation, "target") ?? operation;
}

function reportedTargets(operation: JsonObject, created: Created): Targets {
  const target = targetOf(operation);
  return targetsFrom({
    compositionId: createdIdOf(target.compositionId ?? operation.newCompositionId, created),
    layerId: createdIdOf(target.layerId, created),
    itemId: createdIdOf(target.itemId ?? operation.newFolderId ?? operation.newItemId, created),
    propertyPath: stringAt(target, "propertyPath"),
    effectPath: stringAt(target, "effectPath"),
  });
}

function pathNamed(target: JsonObject, operation: JsonObject, field: "propertyPath" | "effectPath"): string | undefined {
  return stringAt(target, field) || stringAt(operation, field) || undefined;
}

function compositionSource(type: string, target: JsonObject, operation: JsonObject): JsonObject[string] | undefined {
  if (type === "duplicate_composition") return operation.newCompositionId ?? target.compositionId;
  return target.compositionId ?? operation.compositionId ?? operation.newCompositionId;
}

function layerSource(type: string, target: JsonObject, operation: JsonObject): JsonObject[string] | undefined {
  const named = target.layerId ?? operation.layerId;
  return LAYER_CREATING_TYPES.has(type) ? (operation.newLayerId ?? named) : named;
}

function itemSource(target: JsonObject, operation: JsonObject): JsonObject[string] | undefined {
  return target.itemId ?? operation.itemId ?? operation.newFolderId ?? operation.newItemId;
}

function identityOf(operation: JsonObject, created: Created): OperationSlot {
  const target = targetOf(operation);
  const type = stringAt(operation, "type") ?? "undefined";
  const effectPath = pathNamed(target, operation, "effectPath");
  const targets = targetsFrom({
    compositionId: createdIdOf(compositionSource(type, target, operation), created),
    layerId: createdIdOf(layerSource(type, target, operation), created),
    itemId: createdIdOf(itemSource(target, operation), created),
    propertyPath: pathNamed(target, operation, "propertyPath") ?? (type === "ensure_effect" ? effectPath : undefined),
    effectPath,
  });
  return { type, targets };
}

function createdMapOf(created: JsonObject | undefined): Created {
  const ids = Object.entries(created ?? {}).flatMap(([key, value]) => (typeof value === "string" ? [[key, value] as const] : []));
  return Object.fromEntries(ids);
}

/** The host error a receipt carries, with empty text for a part it lacks. */
export function hostErrorOf(receipt: JsonObject): HostError | undefined {
  const hostError = objectAt(receipt, "hostError");
  return hostError ? { code: stringAt(hostError, "code") ?? "", message: stringAt(hostError, "message") ?? "" } : undefined;
}

function confirmedOutcome(type: string, operation: JsonObject, step: JsonObject | undefined): OperationOutcome | undefined {
  if (stringAt(step, "verificationState") === "exact") return "confirmed";
  if (coercedEquivalentOf(type, step)) return "coerced_equivalent";
  return hostEvidenceOf(operation, step)?.strength === "strong" ? "host_confirmed" : undefined;
}

function executedOutcome(type: string, operation: JsonObject, step: JsonObject | undefined): Pick<OperationOutcomeRow, "outcome" | "mutated"> {
  const state = stringAt(step, "verificationState");
  if (state === "failed") return { outcome: "readback_mismatch", mutated: "unknown" };
  if (READ_ONLY_TYPES.has(type)) return { outcome: state === "exact" ? "confirmed" : "host_confirmed", mutated: false };
  const confirmed = confirmedOutcome(type, operation, step);
  return confirmed ? { outcome: confirmed, mutated: true } : { outcome: "applied_unconfirmed", mutated: "unknown" };
}

interface OutcomeContext {
  readonly operations: ReadonlyArray<JsonObject>;
  readonly created: Created;
  readonly hostError: HostError | undefined;
  readonly executed: boolean;
  readonly preflight: boolean;
  readonly failedIndex: number;
  readonly mayHaveMutated: boolean;
  readonly stepForOperation: ReadonlyArray<JsonObject | undefined>;
}

type OutcomeBase = Pick<OperationOutcomeRow, "index" | "type" | "targets" | "unobserved">;
interface UnexecutedVerdict { readonly outcome: OperationOutcome; readonly mutated: boolean | "unknown"; readonly error: boolean }

function failedIndexIn(failure: JsonObject | undefined, executed: boolean, completed: number): number {
  const index = numberAt(failure, "operationIndex");
  if (index !== undefined && index >= 0) return index;
  return !executed && stringAt(failure, "phase") === "apply" ? completed : -1;
}

function isPreflight(receipt: JsonObject, failure: JsonObject | undefined, executed: boolean): boolean {
  const state = stringAt(receipt, "mutationState");
  return !executed && (stringAt(failure, "phase") === "preflight" || state === "not-applied" || state === "rolled-back");
}

function outcomeContextOf(plan: Pick<ActionPlan, "operations"> | undefined, receipt: JsonObject): OutcomeContext {
  const operations = (plan?.operations ?? []).map(operationJson);
  const created = createdMapOf(objectAt(receipt, "created"));
  const failure = objectAt(receipt, "failure");
  const executed = stringAt(receipt, "status") === "executed";
  const steps = (arrayAt(objectAt(receipt, "verification"), "steps") ?? []).map((step): StepSlot | undefined => stepSlotOf(step));
  return {
    operations,
    created,
    hostError: hostErrorOf(receipt),
    executed,
    preflight: isPreflight(receipt, failure, executed),
    failedIndex: failedIndexIn(failure, executed, arrayAt(receipt, "completedOperations")?.length ?? 0),
    mayHaveMutated: booleanAt(receipt, "mayHaveMutated") === true,
    stepForOperation: executed ? stepsForOperations(operations.map((operation) => identityOf(operation, created)), steps) : [],
  };
}

function executedRow(context: OutcomeContext, operation: JsonObject, base: OutcomeBase): OperationOutcomeRow {
  const step = context.stepForOperation[base.index];
  const readBack = readBackOf(step);
  const basis = stringAt(step, "basis");
  const verdict = executedOutcome(base.type, operation, step);
  const reported = verdict.outcome === "applied_unconfirmed" ? (basis ?? "no-read-back") : basis;
  return { ...base, ...verdict, ...(reported === undefined ? {} : { basis: reported }), ...(readBack ? { readBack } : {}) };
}

function unexecutedVerdict(context: OutcomeContext, index: number): UnexecutedVerdict {
  const { preflight, failedIndex, mayHaveMutated } = context;
  if (preflight) return { outcome: "rejected_before_apply", mutated: false, error: true };
  if (index === failedIndex) return { outcome: "failed_during_apply", mutated: mayHaveMutated ? "unknown" : false, error: true };
  if (failedIndex >= 0) return index < failedIndex ? { outcome: "applied_before_failure", mutated: true, error: false } : { outcome: "not_attempted", mutated: false, error: false };
  return mayHaveMutated ? { outcome: "failed_during_apply", mutated: "unknown", error: true } : { outcome: "rejected_before_apply", mutated: false, error: true };
}

function unexecutedRow(context: OutcomeContext, base: OutcomeBase): OperationOutcomeRow {
  const verdict = unexecutedVerdict(context, base.index);
  return { ...base, outcome: verdict.outcome, mutated: verdict.mutated, ...(verdict.error && context.hostError ? { error: context.hostError } : {}) };
}

function operationOutcomeRow(context: OutcomeContext, operation: JsonObject, index: number): OperationOutcomeRow {
  const type = stringAt(operation, "type") ?? "undefined";
  const unobserved = PLAN_TYPE_CONTRACTS[type]?.unobserved;
  const base: OutcomeBase = { index, type, targets: reportedTargets(operation, context.created), ...(unobserved?.length ? { unobserved } : {}) };
  return context.executed ? executedRow(context, operation, base) : unexecutedRow(context, base);
}

const NO_OUTCOMES: Readonly<Record<OperationOutcome, number>> = {
  confirmed: 0, host_confirmed: 0, coerced_equivalent: 0, applied_unconfirmed: 0, readback_mismatch: 0,
  rejected_before_apply: 0, failed_during_apply: 0, applied_before_failure: 0, not_attempted: 0,
};

/** One row per operation saying how it came out, with the counts and whether a failed batch may have changed the project part-way. */
export function operationOutcomes(plan: Pick<ActionPlan, "operations"> | undefined, receipt: JsonObject): OperationOutcomeSummary {
  const context = outcomeContextOf(plan, receipt);
  const rows = context.operations.map((operation, index) => operationOutcomeRow(context, operation, index));
  const counts = { ...NO_OUTCOMES };
  for (const row of rows) counts[row.outcome] += 1;
  return { rows, counts, partialMutation: !context.executed && context.mayHaveMutated, laterOperationsAttempted: false };
}

/** The host failed the batch part-way and took it back whole, proving the project reads as before it: the receipt says so with this state. */
export const ROLLED_BACK_STATE = "rolled-back";

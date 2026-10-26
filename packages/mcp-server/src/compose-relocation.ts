// A field written in the wrong half of an operation (a layerId beside `target`, a groupId inside it) moves to
// the other half only when that operation type's own validator takes it there and refuses it where it is. The
// accepted fields are read from the validator, so a new operation type needs no table here, and a type the
// validator does not know is never touched.
import { LAYER_TARGET_KEYS, acceptedFieldsOfType, acceptedTopLevelFields, flagsField, targetKeyIntroducesProblem } from "@extynt/action-plan";
import { isSameJson, ownTarget, recordChange } from "./compose-correction-core.js";
import type { CorrectionContext, CorrectionStep } from "./compose-correction-core.js";
import { objectAt } from "./json.js";
import { copyFields } from "./operation-fields.js";
import type { OperationFields } from "./operation-fields.js";

const SAME_VALUE_WHY = "the same value was written in both places; the target copy is the one the operation reads";

type Move = "moved" | "dropped" | "conflict";

interface Candidate {
  readonly operation: OperationFields;
  readonly target: OperationFields;
}

function moveField(source: OperationFields, destination: OperationFields, key: string): Move {
  const value = source[key];
  if (value === undefined) return "conflict";
  const held = destination[key];
  if (held === undefined) {
    destination[key] = value;
    delete source[key];
    return "moved";
  }
  if (!isSameJson(held, value)) return "conflict";
  delete source[key];
  return "dropped";
}

function candidateTarget(candidate: OperationFields): OperationFields | undefined {
  const existing = ownTarget(candidate);
  if (existing || typeof candidate.layerId !== "string") return existing;
  const created: OperationFields = {};
  candidate.target = created;
  return created;
}

function targetTakes(candidate: OperationFields, key: string, context: CorrectionContext): boolean {
  const accepted = acceptedFieldsOfType(candidate, context.snapshot);
  if (accepted === undefined || !accepted.includes("target") || accepted.includes(key)) return false;
  return acceptedTopLevelFields(candidate, context.snapshot) !== undefined ? !flagsField(candidate, key, context.snapshot) : !targetKeyIntroducesProblem(candidate, key, context.snapshot);
}

function relocateKeyIntoTarget(operation: OperationFields, key: string, context: CorrectionContext): void {
  if (operation[key] === undefined) return;
  const candidate = copyFields(operation);
  const target = candidateTarget(candidate);
  const outcome = target ? moveField(candidate, target, key) : "conflict";
  if (outcome === "conflict" || !targetTakes(candidate, key, context)) return;
  const value = operation[key];
  Object.assign(operation, candidate);
  delete operation[key];
  if (outcome === "moved") recordChange(context, { field: `target.${key}`, from: `${key} at the top level`, to: value, why: `${context.type} takes ${key} inside target, not beside it` });
  else recordChange(context, { field: key, from: value, to: "(removed)", why: SAME_VALUE_WHY });
}

/** A top-level layerId/compositionId/propertyPath/effectPath the type does not take there, but takes inside target, moves into target. */
export const relocateIntoTarget: CorrectionStep = (operation, context) => {
  for (const key of LAYER_TARGET_KEYS) relocateKeyIntoTarget(operation, key, context);
  return undefined;
};

function candidateWithOwnTarget(operation: OperationFields): Candidate | undefined {
  const candidate = copyFields(operation);
  const target = ownTarget(candidate);
  return target ? { operation: candidate, target } : undefined;
}

function relocateKeyOutOfTarget(operation: OperationFields, key: string, context: CorrectionContext): void {
  const candidate = candidateWithOwnTarget(operation);
  if (!candidate) return;
  const value = candidate.target[key];
  if (moveField(candidate.target, candidate.operation, key) !== "moved") return;
  if (!acceptedTopLevelFields(candidate.operation, context.snapshot)?.includes(key)) return;
  Object.assign(operation, candidate.operation);
  recordChange(context, { field: key, from: `target.${key}`, to: value, why: `${context.type} takes ${key} beside target, not inside it` });
}

/** A field written inside target that the type takes beside it (and the target never carries) moves to the top level. */
export const relocateOutOfTarget: CorrectionStep = (operation, context) => {
  const target = objectAt(operation, "target");
  if (!target) return undefined;
  for (const key of Object.keys(target).filter((field) => !LAYER_TARGET_KEYS.includes(field) && target[field] !== undefined)) relocateKeyOutOfTarget(operation, key, context);
  return undefined;
};

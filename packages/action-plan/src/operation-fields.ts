// What one operation type accepts, read from the validator that enforces it rather than copied beside it:
// the top-level field list its UNKNOWN_FIELD check uses, and whether a candidate rewrite leaves a field unflagged.
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { JsonObject } from "@extynt/decode";
import { isJsonObject } from "./json-shape.js";
import { toJsonValue } from "./plain-json.js";
import { collectOperationProblemsJson } from "./plan-validation.js";
import { LAYER_TARGET_FIELDS, observeAcceptedFields } from "./validation-primitives.js";

const PROBE_FIELD = "__acceptedFieldsProbe";
const PROBE_COMPOSITION = "__acceptedFieldsProbeComposition";

/** Fields a layer target carries on any operation; a target holding another key is flagged by the validator. */
export const LAYER_TARGET_KEYS: readonly string[] = LAYER_TARGET_FIELDS;

type FieldsInput = { readonly [key: string]: FieldValue };
type FieldValue = null | boolean | number | string | readonly FieldValue[] | FieldsInput;

function objectOf(input: FieldsInput): JsonObject {
  const json = toJsonValue(input);
  return isJsonObject(json) ? json : {};
}

const IDENTITY = { snapshotFingerprint: "field-probe-snapshot", selectionFingerprint: "field-probe-selection" };

function planOf(operation: JsonObject): JsonObject {
  const target = operation.target;
  const stamped = isJsonObject(target) ? { ...operation, target: { ...target, ...IDENTITY } } : { ...operation, ...IDENTITY };
  return { ...IDENTITY, operations: [stamped] };
}

function readAllowlist(candidate: JsonObject, snapshot: ProjectSnapshot | undefined): readonly string[] | undefined {
  let accepted: readonly string[] | undefined;
  const probe = { ...candidate, [PROBE_FIELD]: true };
  observeAcceptedFields((value, allowed) => { if (accepted === undefined && PROBE_FIELD in value) accepted = [...allowed]; }, () => collectOperationProblemsJson(planOf(probe), snapshot));
  return accepted;
}

/**
 * The top-level fields this operation's validator accepts, or undefined when the validator stops before it checks
 * them (an unknown type, or a target that does not resolve). The operation is validated with one extra field so the
 * check runs on a copy of the caller's own operation and its allowlist is the one reported.
 */
export function acceptedTopLevelFields(operation: FieldsInput, snapshot?: ProjectSnapshot): readonly string[] | undefined {
  return readAllowlist(objectOf(operation), snapshot);
}

/**
 * The same allowlist for an operation whose target the snapshot cannot ground yet (no composition named, or a layer
 * or composition created earlier in the plan). The allowlist belongs to the operation type, not to the project, so it
 * is read again against a stand-in composition and no snapshot. It says what the type accepts, not whether this
 * target exists, so it cannot clear a field the validator would flag.
 */
export function acceptedFieldsOfType(input: FieldsInput, snapshot?: ProjectSnapshot): readonly string[] | undefined {
  const operation = objectOf(input);
  const grounded = readAllowlist(operation, snapshot);
  if (grounded !== undefined) return grounded;
  const target = operation.target;
  if (!isJsonObject(target)) return undefined;
  return readAllowlist({ ...operation, target: { compositionId: PROBE_COMPOSITION, ...target } }, undefined);
}

/** Whether validating this operation raises a problem about `field` being unknown or misplaced. */
export function flagsField(operation: FieldsInput, field: string, snapshot?: ProjectSnapshot): boolean {
  return collectOperationProblemsJson(planOf(objectOf(operation)), snapshot).some((problem) => problem.message.includes(`Unknown field: ${field}`) || problem.message.includes(`${field} is not a target field`));
}

const STRUCTURAL_CODES = ["UNKNOWN_FIELD", "INVALID_OPERATION", "INVALID_TARGET"];

/**
 * Whether carrying `key` inside the target of `candidate` makes the validator raise a structural problem (an unknown
 * or misplaced field, a malformed operation or target) that the same operation without it does not. Used for a target
 * that names a layer created earlier in the plan: the operation is validated against a real layer of the snapshot
 * standing in for it, because the target's own layer cannot be looked up. With no layer to stand in, it says yes.
 */
export function targetKeyIntroducesProblem(input: FieldsInput, key: string, snapshot?: ProjectSnapshot): boolean {
  const candidate = objectOf(input);
  const target = candidate.target;
  const composition = snapshot?.compositions.find((entry) => entry.layers.length > 0);
  const layer = composition?.layers[0];
  if (!snapshot || !composition || !layer || !isJsonObject(target)) return true;
  const standIn: JsonObject = { ...target, compositionId: composition.id, layerId: layer.id };
  const messagesOf = (stoodIn: JsonObject): string[] => collectOperationProblemsJson(planOf({ ...candidate, target: stoodIn }), snapshot).filter((problem) => STRUCTURAL_CODES.includes(problem.code)).map((problem) => problem.message);
  const without = Object.fromEntries(Object.entries(standIn).filter(([field]) => field !== key));
  const before = new Set(messagesOf(without));
  return messagesOf(standIn).some((message) => !before.has(message));
}

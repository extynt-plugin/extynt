// Shared validation primitives: the named-error assertion and the bounded id, text, timestamp, list and criterion checks every transition uses.

import { WorkflowTransitionError } from "./errors.js";
import type { WorkflowErrorCode } from "./events.js";
import { isWorkflowId } from "./identity.js";
import { MAX_WORKFLOW_CRITERIA_PER_OWNER, MAX_WORKFLOW_SUMMARY_LENGTH } from "./limits.js";
import type { WorkflowSuccessCriterion } from "./state-types.js";

const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Throws the package's named error for a rejected transition. */
export function fail(code: WorkflowErrorCode, message: string): never {
  throw new WorkflowTransitionError(code, message);
}

/** Throws the named error unless the condition holds, narrowing like a type guard. */
export function assert(condition: boolean, code: WorkflowErrorCode, message: string): asserts condition {
  if (!condition) fail(code, message);
}

/** Whether the value is non-blank text within `max` UTF-8 bytes. */
export function isBoundedText(value: string, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && Buffer.byteLength(value, "utf8") <= max;
}

/** Returns the text when it is non-blank and within `max` UTF-8 bytes. */
export function boundedText(value: string, name: string, max: number): string {
  assert(isBoundedText(value, max), "INVALID_EVENT", `${name} must be 1-${max} UTF-8 bytes.`);
  return value;
}

/** Returns the identifier when it is a bounded workflow id. */
export function id(value: string, name: string): string {
  assert(isWorkflowId(value), "INVALID_EVENT", `${name} is not a bounded workflow id.`);
  return value;
}

/** Whether the value is a strict, round-trippable ISO-8601 UTC instant. */
export function isTimestamp(value: string): value is string {
  return typeof value === "string" && TIMESTAMP_PATTERN.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

/** Returns the timestamp when it is a strict, round-trippable ISO-8601 UTC instant. */
export function timestamp(value: string): string {
  assert(isTimestamp(value), "INVALID_EVENT", "Timestamps must be strict ISO-8601 UTC timestamps.");
  return value;
}

/** Returns the ids when they are bounded in number, individually valid and distinct. */
export function uniqueIds(values: readonly string[], name: string, max: number): readonly string[] {
  assert(values.length <= max, "LIMIT_EXCEEDED", `${name} exceeds its bound.`);
  const result = values.map((value) => id(value, name));
  assert(new Set(result).size === result.length, "INVALID_EVENT", `${name} must not contain duplicates.`);
  return result;
}

function validCriterion(entry: WorkflowSuccessCriterion): WorkflowSuccessCriterion {
  const criterionId = id(entry.criterionId, "criterionId");
  const description = boundedText(entry.description, "criterion description", MAX_WORKFLOW_SUMMARY_LENGTH);
  const requiredEvidenceKind = entry.requiredEvidenceKind;
  return { criterionId, description, ...(requiredEvidenceKind ? { requiredEvidenceKind } : {}) };
}

/** Returns the success criteria when they are bounded, well formed and distinct by id. */
export function criteria(values: readonly WorkflowSuccessCriterion[] | undefined, name: string): readonly WorkflowSuccessCriterion[] {
  const input = values ?? [];
  assert(input.length <= MAX_WORKFLOW_CRITERIA_PER_OWNER, "LIMIT_EXCEEDED", `${name} exceeds its criterion bound.`);
  const result = input.map((entry) => validCriterion(entry));
  assert(new Set(result.map((criterion) => criterion.criterionId)).size === result.length, "INVALID_EVENT", `${name} must not contain duplicate criteria.`);
  return result;
}

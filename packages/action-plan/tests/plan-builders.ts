// Builders shared by the action-plan suites: they seal typed operations into a v0.2 plan and read the validator's answer as one comparable string.
import assert from "node:assert/strict";
import { representativeSnapshot, type ProjectSnapshot } from "@extynt/project-graph";
import { type JsonObject, type JsonValue } from "@extynt/decode";
import { validateActionPlanJson, type ActionPlan, type PlanValidation, type PlanWarning } from "../src/index.js";
import { planDigestJson } from "../src/plan-digest.js";

export interface PlanSpec {
  readonly operations: readonly JsonValue[];
  readonly snapshot?: ProjectSnapshot;
  readonly planId?: string;
  readonly bounds?: JsonObject;
  readonly fields?: JsonObject;
}

export type PlanOptions = Omit<PlanSpec, "operations">;
export type OperationRow = readonly [expected: string, operation: JsonObject];
export type SequenceRow = readonly [expected: string, operations: readonly JsonValue[]];
export type Refusal = Extract<PlanValidation, { ok: false }>;

export const GENEROUS_BOUNDS = { maxOperations: 16, maxKeyframes: 16, maxExpressionLength: 4096 } satisfies JsonObject;

export function buildPlan(spec: PlanSpec): JsonObject {
  const snapshot = spec.snapshot ?? representativeSnapshot;
  const unsealed = {
    schemaVersion: "0.2",
    planId: spec.planId ?? "test-plan",
    snapshotFingerprint: snapshot.fingerprint,
    selectionFingerprint: snapshot.selectionFingerprint,
    freshness: snapshot.freshness,
    summary: "Test plan",
    requiresApproval: true,
    bounds: spec.bounds ?? { maxOperations: spec.operations.length },
    preconditions: [],
    conflicts: [],
    postconditions: [],
    operations: [...spec.operations],
    ...spec.fields,
    digest: "",
  } satisfies JsonObject;
  return { ...unsealed, digest: planDigestJson(unsealed) };
}

export function validate(operations: readonly JsonValue[], options: PlanOptions = {}): PlanValidation {
  return validateActionPlanJson(buildPlan({ ...options, operations }), options.snapshot ?? representativeSnapshot);
}

export function verdict(operations: readonly JsonValue[], options: PlanOptions = {}): string {
  const result = validate(operations, options);
  return result.ok ? "ok" : result.code;
}

export function refusal(operations: readonly JsonValue[], options: PlanOptions = {}): Refusal {
  const result = validate(operations, options);
  if (result.ok) assert.fail(`expected a refusal, the plan was accepted: ${JSON.stringify(operations)}`);
  return result;
}

export function warningsOf(operations: readonly JsonValue[], options: PlanOptions = {}): readonly PlanWarning[] {
  const result = validate(operations, options);
  if (!result.ok) assert.fail(`expected the plan to be accepted: ${result.code} ${result.message}`);
  return result.warnings;
}

export function acceptedPlan(operations: readonly JsonValue[], options: PlanOptions = {}): ActionPlan {
  const result = validate(operations, options);
  if (!result.ok) assert.fail(`expected the plan to be accepted: ${result.code} ${result.message}`);
  return result.plan;
}

export function assertOperations(rows: readonly OperationRow[], options: PlanOptions = {}): void {
  for (const [expected, operation] of rows) assert.equal(verdict([operation], options), expected, JSON.stringify(operation));
}

export function assertSequences(rows: readonly SequenceRow[], options: PlanOptions = {}): void {
  for (const [expected, operations] of rows) assert.equal(verdict(operations, options), expected, JSON.stringify(operations));
}

/**
 * Deterministic fixture host for typed plans: a model, not an emulator. Modelled operations mutate a
 * private copy of the caller's snapshot; anything the fixture cannot reproduce is refused by name,
 * never faked, and a refusal leaves no partial edit. No clock, randomness, filesystem or network.
 *
 * The host's entry surface. The domains it dispatches to live in the sibling `fake-host-*` modules.
 */

import { canonicalSnapshot, createSnapshot, stableStringify, type ProjectSnapshot } from "@extynt/project-graph";
import { isWireArray, isWireObject } from "@extynt/fake-plugin";
import { APPLIERS } from "./fake-host-appliers.js";
import { createContext, type ApplyOutcome, type FailedDeclaration, type FixtureApplyContext } from "./fake-host-context.js";
import { CANONICAL_PREFIX, DECLARED_FIELDS, DEPENDENCY_FAILED, IMPLEMENTED_TYPES, PLAN_TYPES } from "./fake-host-tables.js";
import { FixtureRefusal, own, refuse, unsupportedType } from "./fake-host-values.js";
import type { WireObject, WireValue } from "./wire-types.js";

/** What happened to one operation: applied, or refused with a code and a message. */
export interface FixtureOperationVerdict { index: number; type: string; ok: boolean; code?: string; message?: string }

/** The edited snapshot, one verdict per operation, and what the apply call bound and observed. */
export interface FixtureApplyResult {
  snapshot: ProjectSnapshot;
  revision: string;
  verdicts: FixtureOperationVerdict[];
  mutated: boolean;
  bindings: Readonly<Record<string, string>>;
  evidence: ReadonlyMap<number, WireObject>;
}

interface OperationSlot { index: number; type: string; operation: WireObject }

/** Which of the 55 typed plan operations this fixture applies, and which it refuses. */
export function fixtureOperationCoverage(): { implemented: string[]; refused: string[] } {
  return {
    implemented: [...IMPLEMENTED_TYPES].sort(),
    refused: [...PLAN_TYPES].filter((type) => !IMPLEMENTED_TYPES.has(type)).sort(),
  };
}

function declaredNameAt(operation: WireObject, [head, tail]: readonly [string, string]): string[] {
  const container = head ? operation[head] : operation;
  const value = isWireObject(container) ? container[tail] : undefined;
  return typeof value === "string" && value.startsWith(CANONICAL_PREFIX) ? [value] : [];
}

function declaredNamesOf(operation: WireObject): string[] {
  const type = operation.type;
  const fields = (typeof type === "string" ? own(DECLARED_FIELDS, type) : undefined) ?? [];
  return fields.flatMap((field) => declaredNameAt(operation, field));
}

function stringsIn(value: WireValue): string[] {
  if (typeof value === "string") return [value];
  if (isWireArray(value)) return value.flatMap(stringsIn);
  return isWireObject(value) ? Object.values(value).flatMap(stringsIn) : [];
}

function failedDependency(context: FixtureApplyContext, operation: WireObject): { name: string; failure: FailedDeclaration } | undefined {
  const declared = new Set(declaredNamesOf(operation));
  const found = stringsIn(operation).flatMap((name) => {
    const failure = context.failedDeclarations.get(name);
    return failure && !declared.has(name) ? [{ name, failure }] : [];
  });
  return found.sort((left, right) => left.failure.index - right.failure.index)[0];
}

function nextRevision(base: string): string {
  const [, stem, count] = /^(.*)\+fx([0-9]+)$/.exec(base) ?? [];
  return stem !== undefined && count !== undefined ? `${stem}+fx${Number(count) + 1}` : `${base}+fx1`;
}

function operationTypeOf(operation: WireObject): string {
  const type = operation.type;
  return typeof type === "string" ? type : "unknown";
}

function dependencyVerdict(context: FixtureApplyContext, slot: OperationSlot): FixtureOperationVerdict | undefined {
  const dependency = failedDependency(context, slot.operation);
  if (!dependency) return undefined;
  return {
    index: slot.index, type: slot.type, ok: false, code: DEPENDENCY_FAILED,
    message: `Operation ${slot.index} (${slot.type}) depends on ${dependency.name}, which operation ${dependency.failure.index} (${dependency.failure.type}) was refused and therefore never created.`,
  };
}

function dispatchOperation(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const type = operation.type;
  if (typeof type !== "string" || type.length === 0) refuse("INVALID_OPERATION", "Operation requires a type.");
  const applier = own(APPLIERS, type);
  if (!applier) unsupportedType(type);
  return applier(context, operation);
}

function recordFailedDeclarations(context: FixtureApplyContext, slot: OperationSlot): void {
  for (const name of declaredNamesOf(slot.operation)) if (!context.bindings[name]) context.failedDeclarations.set(name, { index: slot.index, type: slot.type });
}

function runOperation(context: FixtureApplyContext, slot: OperationSlot): FixtureOperationVerdict {
  const dependency = dependencyVerdict(context, slot);
  if (dependency) return dependency;
  context.evidence = {};
  try {
    const message = dispatchOperation(context, slot.operation);
    if (Object.keys(context.evidence).length > 0) context.evidenceByIndex.set(slot.index, context.evidence);
    return { index: slot.index, type: slot.type, ok: true, ...(typeof message === "string" ? { message } : {}) };
  } catch (error) {
    const refusal = error instanceof FixtureRefusal ? error : new FixtureRefusal("FIXTURE_FAILURE", String(error instanceof Error ? error.message : error));
    recordFailedDeclarations(context, slot);
    return { index: slot.index, type: slot.type, ok: false, code: refusal.code, message: refusal.message };
  }
}

/** Applies the operations in order to a private copy of the snapshot; a refused operation leaves no partial edit. */
export function applyOperationsToFixture(input: { snapshot: ProjectSnapshot; operations: readonly WireObject[]; revision?: string }): FixtureApplyResult {
  const source = input.snapshot;
  const working = structuredClone(source);
  const context = createContext(working);
  const verdicts = input.operations.map((operation, index) => runOperation(context, { index, type: operationTypeOf(operation), operation }));
  const mutated = stableStringify(canonicalSnapshot(working)) !== stableStringify(canonicalSnapshot(source));
  const revision = mutated ? nextRevision(input.revision ?? source.revision) : source.revision;
  const snapshot = createSnapshot({
    ...working,
    revision,
    freshness: { revision, capturedAt: source.capturedAt, receivedAt: source.freshness?.receivedAt ?? null },
  });
  return { snapshot, revision, verdicts, mutated, bindings: context.bindings, evidence: context.evidenceByIndex };
}

// Batch closure analysis: the placeholder dependency graph and the mutation and host-time budgets of one proposed operation list.

import type { ActionPlanV2Operation } from "@extynt/action-plan";
import { isJsonArray, isJsonObject } from "@extynt/decode";
import { objectView, valueAtPath } from "./json-view.js";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { MAX_WORKFLOW_OPERATIONS_PER_BATCH } from "./limits.js";
import { CREATOR_PLACEHOLDER_PATHS, isPlaceholderLike, isPlaceholderName } from "./placeholders.js";

/** The hard per-batch ceilings: one batch is one host undo unit, so cost is bounded by operation count, weighted mutation units and weighted host-time units rather than wall-clock time. */
export const WORKFLOW_BATCH_BUDGET = {
  maxOperations: MAX_WORKFLOW_OPERATIONS_PER_BATCH,
  maxMutationUnits: 512,
  maxHostTimeUnits: 1_024,
} as const;

export type WorkflowBatchClosureCode =
  | "EMPTY_BATCH"
  | "OPERATION_BOUND"
  | "MUTATION_BUDGET"
  | "HOST_TIME_BUDGET"
  | "PLACEHOLDER_INVALID"
  | "DEPENDENCY_UNRESOLVED"
  | "DEPENDENCY_ORDER";

export interface WorkflowBatchBudget {
  readonly maxOperations: number;
  readonly maxMutationUnits: number;
  readonly maxHostTimeUnits: number;
}

export interface WorkflowBatchDependency {
  readonly operation: number;
  readonly dependsOn: number;
  readonly placeholder: string;
}

export interface WorkflowBatchClosure {
  readonly ok: true;
  readonly dependencies: readonly WorkflowBatchDependency[];
  readonly mutationUnits: number;
  readonly hostTimeUnits: number;
}

export interface WorkflowBatchClosureFailure {
  readonly ok: false;
  readonly code: WorkflowBatchClosureCode;
  readonly index?: number;
  readonly placeholder?: string;
  readonly message: string;
}

export type WorkflowBatchClosureResult = WorkflowBatchClosure | WorkflowBatchClosureFailure;
type ProducerResult = { readonly ok: true; readonly producers: ReadonlyMap<string, number> } | WorkflowBatchClosureFailure;
type DependencyResult = { readonly ok: true; readonly dependencies: readonly WorkflowBatchDependency[] } | WorkflowBatchClosureFailure;
type PlaceholderReference = { readonly value: string; readonly path: string };
type OperationKind = "idempotent" | "ensuring" | "creating" | "destructive" | "external";

const MUTATION_COST: Readonly<Record<OperationKind, number>> = { idempotent: 1, ensuring: 1, creating: 2, destructive: 3, external: 4 };
const OPERATION_KIND_PATTERNS: readonly (readonly [RegExp, OperationKind])[] = [
  [/render|export|write_file|external/i, "external"],
  [/delete|remove|clear|replace/i, "destructive"],
  [/create|duplicate|precompose|import|add/i, "creating"],
  [/ensure|set|update|animate|move|reorder|apply/i, "ensuring"],
];

function identifierPath(path: string): boolean {
  const field = path.replace(/\[\d+\]$/u, "").split(".").at(-1) ?? "";
  return /Ids?$/u.test(field);
}

function isReference(value: string, path: string, skip: ReadonlySet<string>): boolean {
  return isPlaceholderLike(value) && identifierPath(path) && !skip.has(path);
}

function placeholderReferences(value: JsonValue, path: string, skip: ReadonlySet<string>, out: PlaceholderReference[]): void {
  if (typeof value === "string") {
    if (isReference(value, path, skip)) out.push({ value, path });
    return;
  }
  if (isJsonArray(value)) {
    value.forEach((entry, index) => placeholderReferences(entry, `${path}[${index}]`, skip, out));
    return;
  }
  if (!isJsonObject(value)) return;
  for (const [key, entry] of Object.entries(value)) placeholderReferences(entry, path ? `${path}.${key}` : key, skip, out);
}

function operationKind(type: string): OperationKind {
  return OPERATION_KIND_PATTERNS.find(([pattern]) => pattern.test(type))?.[1] ?? "idempotent";
}

function hasTime(entry: JsonValue): boolean {
  return isJsonObject(entry) && entry.time !== undefined;
}

function keyframeTotal(values: readonly JsonValue[]): number {
  return values.reduce<number>((sum, entry) => sum + keyframeCount(entry), 0);
}

function keyframeCount(value: JsonValue): number {
  if (isJsonArray(value)) return value.every(hasTime) ? value.length : keyframeTotal(value);
  if (isJsonObject(value)) return keyframeTotal(Object.values(value));
  return 0;
}

function hostTimeCost(operation: JsonObject, type: string): number {
  const typeWeight = /render|export/i.test(type) ? 8 : 1;
  return typeWeight + keyframeCount(operation) * 2;
}

function effectiveBatchBudget(budget: WorkflowBatchBudget): WorkflowBatchBudget {
  const bounded = (value: number, ceiling: number): number => Math.max(0, Math.min(ceiling, Number.isFinite(value) ? Math.floor(value) : 0));
  return {
    maxOperations: bounded(budget.maxOperations, WORKFLOW_BATCH_BUDGET.maxOperations),
    maxMutationUnits: bounded(budget.maxMutationUnits, WORKFLOW_BATCH_BUDGET.maxMutationUnits),
    maxHostTimeUnits: bounded(budget.maxHostTimeUnits, WORKFLOW_BATCH_BUDGET.maxHostTimeUnits),
  };
}

function registerProducer(producers: Map<string, number>, value: string, index: number): WorkflowBatchClosureFailure | undefined {
  if (!isPlaceholderName(value)) {
    return isPlaceholderLike(value) ? { ok: false, code: "PLACEHOLDER_INVALID", index, placeholder: value, message: `Operation ${index} declares malformed placeholder ${JSON.stringify(value)}; placeholders must match __new__:[A-Za-z0-9._-]{1,128}.` } : undefined;
  }
  if (producers.has(value)) return { ok: false, code: "DEPENDENCY_UNRESOLVED", index, placeholder: value, message: `Placeholder ${value} is produced more than once in this batch.` };
  producers.set(value, index);
  return undefined;
}

function collectProducers(operations: readonly ActionPlanV2Operation[]): ProducerResult {
  const producers = new Map<string, number>();
  for (const [index, operation] of operations.entries()) {
    const record = objectView(operation);
    if (record === undefined) continue;
    for (const field of CREATOR_PLACEHOLDER_PATHS[operation.type] ?? []) {
      const value = valueAtPath(record, field);
      const failure = typeof value === "string" ? registerProducer(producers, value, index) : undefined;
      if (failure) return failure;
    }
  }
  return { ok: true, producers };
}

function dependencyFor(ref: PlaceholderReference, index: number, producers: ReadonlyMap<string, number>): WorkflowBatchDependency | WorkflowBatchClosureFailure {
  if (!isPlaceholderName(ref.value)) return { ok: false, code: "PLACEHOLDER_INVALID", index, placeholder: ref.value, message: `Operation ${index} references malformed placeholder ${JSON.stringify(ref.value)} at ${ref.path}; placeholders must match __new__:[A-Za-z0-9._-]{1,128}.` };
  const producer = producers.get(ref.value);
  if (producer === undefined) return { ok: false, code: "DEPENDENCY_UNRESOLVED", index, placeholder: ref.value, message: `Operation ${index} references ${ref.value}, but this batch does not create it. Earlier-batch placeholders must be rebound to a verified host id before admission.` };
  if (producer >= index) return { ok: false, code: "DEPENDENCY_ORDER", index, placeholder: ref.value, message: `Operation ${index} depends on ${ref.value}, which is created at operation ${producer}; dependency producers must precede their consumers in one batch.` };
  return { operation: index, dependsOn: producer, placeholder: ref.value };
}

function dependenciesForOperation(operation: JsonObject, type: string, index: number, producers: ReadonlyMap<string, number>): DependencyResult {
  const refs: PlaceholderReference[] = [];
  placeholderReferences(operation, "", new Set(CREATOR_PLACEHOLDER_PATHS[type] ?? []), refs);
  const dependencies: WorkflowBatchDependency[] = [];
  for (const ref of refs) {
    const dependency = dependencyFor(ref, index, producers);
    if ("ok" in dependency) return dependency;
    dependencies.push(dependency);
  }
  return { ok: true, dependencies };
}

function analyzeOperations(operations: readonly ActionPlanV2Operation[], producers: ReadonlyMap<string, number>, budget: WorkflowBatchBudget): WorkflowBatchClosureResult {
  const dependencies: WorkflowBatchDependency[] = [];
  let mutationUnits = 0;
  let hostTimeUnits = 0;
  for (const [index, operation] of operations.entries()) {
    const record = objectView(operation);
    if (record === undefined) continue;
    const result = dependenciesForOperation(record, operation.type, index, producers);
    if (!result.ok) return result;
    dependencies.push(...result.dependencies);
    mutationUnits += MUTATION_COST[operationKind(operation.type)];
    hostTimeUnits += hostTimeCost(record, operation.type);
  }
  if (mutationUnits > budget.maxMutationUnits) return { ok: false, code: "MUTATION_BUDGET", message: `The proposed batch costs ${mutationUnits} mutation units; the safe batch budget is ${budget.maxMutationUnits}.` };
  if (hostTimeUnits > budget.maxHostTimeUnits) return { ok: false, code: "HOST_TIME_BUDGET", message: `The proposed batch costs ${hostTimeUnits} host-time units; the safe batch budget is ${budget.maxHostTimeUnits}.` };
  return { ok: true, dependencies, mutationUnits, hostTimeUnits };
}

/** Analyses one proposed operation list without partitioning or reordering it: a clean closure is admitted as-is or refused with a repairable reason, and a custom budget can tighten but never widen the hard ceilings. */
export function analyzeWorkflowBatch(operations: readonly ActionPlanV2Operation[], budget: WorkflowBatchBudget = WORKFLOW_BATCH_BUDGET): WorkflowBatchClosureResult {
  if (operations.length === 0) return { ok: false, code: "EMPTY_BATCH", message: "A workflow batch must contain at least one typed operation." };
  const effectiveBudget = effectiveBatchBudget(budget);
  if (operations.length > effectiveBudget.maxOperations) return { ok: false, code: "OPERATION_BOUND", message: `The proposed batch contains ${operations.length} operations; the safe batch limit is ${effectiveBudget.maxOperations}.` };
  const producers = collectProducers(operations);
  return producers.ok ? analyzeOperations(operations, producers.producers, effectiveBudget) : producers;
}

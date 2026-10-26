// Created-id bindings: which placeholders a verified receipt proves, and the conflicts that withdraw a binding.

import type { ActionPlan } from "@extynt/action-plan";
import { decode, fallback, type Infer, object, optional, string } from "@extynt/decode";
import type { WorkflowCreatedBinding, WorkflowOperationOutcome, WorkflowReceipt } from "@extynt/workflow";
import { verifiedRow } from "./workflow-coordinator-outcomes.js";
import type { PanelStep, ReceiptFacts } from "./workflow-panel-receipt.js";

type DeclaringField = "target.layerId" | "newLayerId" | "newCompositionId" | "newFolderId" | "newItemId";
type ReadbackField = "layerId" | "compositionId" | "newCompositionId" | "itemId";
interface CreatorRule { readonly declares: DeclaringField; readonly reads: ReadbackField }

const NEW_PREFIX = "__new__:";
const MAX_BINDINGS = 64;
const SECRET_LIKE = /\b(?:sk|rk|xoxb|ghp|github_pat)[_-][A-Za-z0-9_-]{8,}\b/i;

const CREATOR_RULES: Readonly<Record<string, readonly CreatorRule[]>> = {
  create_layer: [{ declares: "target.layerId", reads: "layerId" }],
  duplicate_layer: [{ declares: "newLayerId", reads: "layerId" }],
  derive_layer: [{ declares: "newLayerId", reads: "layerId" }],
  create_composition: [{ declares: "newCompositionId", reads: "compositionId" }],
  duplicate_composition: [{ declares: "newCompositionId", reads: "compositionId" }],
  precompose_layers: [{ declares: "newCompositionId", reads: "newCompositionId" }, { declares: "newLayerId", reads: "layerId" }],
  create_folder: [{ declares: "newFolderId", reads: "itemId" }],
  import_file: [{ declares: "newItemId", reads: "itemId" }],
  create_vector_artwork: [{ declares: "newItemId", reads: "itemId" }],
};

const creatorFields = object({
  target: optional(fallback(object({ layerId: optional(fallback(string(), undefined)) }), undefined)),
  newLayerId: optional(fallback(string(), undefined)),
  newCompositionId: optional(fallback(string(), undefined)),
  newFolderId: optional(fallback(string(), undefined)),
  newItemId: optional(fallback(string(), undefined)),
});

type CreatorFields = Infer<typeof creatorFields>;

const DECLARED_VALUE: Readonly<Record<DeclaringField, (fields: CreatorFields) => string | undefined>> = {
  "target.layerId": (fields) => fields.target?.layerId,
  newLayerId: (fields) => fields.newLayerId,
  newCompositionId: (fields) => fields.newCompositionId,
  newFolderId: (fields) => fields.newFolderId,
  newItemId: (fields) => fields.newItemId,
};

interface Accumulator {
  readonly bindings: WorkflowCreatedBinding[];
  readonly seen: Map<string, string>;
  readonly conflictingPlaceholders: Set<string>;
  readonly conflictingIds: Set<string>;
}

interface Candidate {
  readonly placeholder: string;
  readonly actual: string | undefined;
  readonly claimed: string | undefined;
  readonly row: WorkflowOperationOutcome;
  readonly readbackField: ReadbackField;
  readonly afterFingerprint: string;
}

interface Conflict {
  readonly placeholder: string;
  readonly actual: string;
  readonly priorId: string | undefined;
  readonly priorPlaceholder: string | undefined;
}

function withdraw(accumulator: Accumulator, placeholder: string): void {
  for (let index = accumulator.bindings.length - 1; index >= 0; index -= 1) {
    if (accumulator.bindings[index]?.placeholder === placeholder) accumulator.bindings.splice(index, 1);
  }
}

function poison(accumulator: Accumulator, conflict: Conflict): void {
  const { placeholder, actual, priorId, priorPlaceholder } = conflict;
  withdraw(accumulator, placeholder);
  if (priorPlaceholder) {
    withdraw(accumulator, priorPlaceholder);
    accumulator.conflictingPlaceholders.add(priorPlaceholder);
    accumulator.seen.delete(priorPlaceholder);
  }
  accumulator.conflictingPlaceholders.add(placeholder);
  accumulator.conflictingIds.add(actual);
  if (priorId) accumulator.conflictingIds.add(priorId);
  accumulator.seen.delete(placeholder);
}

function usableId(actual: string | undefined, claimed: string | undefined): actual is string {
  return !!actual && actual === claimed && !actual.startsWith(NEW_PREFIX) && !SECRET_LIKE.test(actual);
}

function bind(accumulator: Accumulator, candidate: Candidate): void {
  const { placeholder, actual, claimed, row, readbackField, afterFingerprint } = candidate;
  if (!usableId(actual, claimed)) return;
  if (accumulator.conflictingPlaceholders.has(placeholder) || accumulator.conflictingIds.has(actual)) return;
  const priorId = accumulator.seen.get(placeholder);
  const priorPlaceholder = [...accumulator.seen.entries()].find(([, id]) => id === actual)?.[0];
  if (priorId !== undefined || (priorPlaceholder !== undefined && priorPlaceholder !== placeholder)) {
    poison(accumulator, { placeholder, actual, priorId, priorPlaceholder });
    return;
  }
  accumulator.seen.set(placeholder, actual);
  accumulator.bindings.push({ placeholder, createdId: actual.slice(0, 512), operationId: row.operationId, readbackField, observedFingerprint: afterFingerprint });
}

interface OperationInput {
  readonly facts: ReceiptFacts;
  readonly operation: ActionPlan["operations"][number];
  readonly row: WorkflowOperationOutcome | undefined;
  readonly ordinal: number;
}

function exactCreatorStep(step: PanelStep | undefined, type: string): step is PanelStep {
  return step?.verificationState === "exact" && step.operation === type && step.observed === true;
}

function declaredPlaceholders(rules: readonly CreatorRule[], fields: CreatorFields): readonly string[] {
  return rules.flatMap((rule) => DECLARED_VALUE[rule.declares](fields) ?? []).filter((value) => value.startsWith(NEW_PREFIX));
}

interface VerifiedCreator {
  readonly rules: readonly CreatorRule[];
  readonly fields: CreatorFields;
  readonly step: PanelStep;
  readonly row: WorkflowOperationOutcome;
}

function verifiedCreator(input: OperationInput): VerifiedCreator | undefined {
  const { facts, operation, row, ordinal } = input;
  const rules = CREATOR_RULES[operation.type];
  const step = facts.steps[ordinal];
  const decoded = decode(creatorFields, operation);
  if (!rules || !verifiedRow(row) || !decoded.ok || !exactCreatorStep(step, operation.type)) return undefined;
  return { rules, fields: decoded.value, step, row };
}

function inspectOperation(accumulator: Accumulator, input: OperationInput): void {
  const found = verifiedCreator(input);
  if (!found) return;
  for (const placeholder of declaredPlaceholders(found.rules, found.fields)) {
    const matching = found.rules.filter((rule) => DECLARED_VALUE[rule.declares](found.fields) === placeholder);
    const [only] = matching;
    if (matching.length !== 1 || only === undefined) continue;
    bind(accumulator, { placeholder, actual: found.step[only.reads], claimed: input.facts.created?.[placeholder], row: found.row, readbackField: only.reads, afterFingerprint: input.facts.afterFingerprint ?? "" });
  }
}

/** The created ids a verified receipt proves for the placeholders its creator operations declared; an ambiguous or mismatched identity is withdrawn rather than guessed. */
export function authoritativeCreatedBindings(input: { readonly plan: ActionPlan; readonly facts: ReceiptFacts; readonly rows: readonly WorkflowOperationOutcome[]; readonly verification: WorkflowReceipt["verification"] }): readonly WorkflowCreatedBinding[] | undefined {
  const { plan, facts, rows, verification } = input;
  if (verification !== "verified" || !facts.created) return undefined;
  const accumulator: Accumulator = { bindings: [], seen: new Map(), conflictingPlaceholders: new Set(), conflictingIds: new Set() };
  plan.operations.forEach((operation, ordinal) => inspectOperation(accumulator, { facts, operation, row: rows[ordinal], ordinal }));
  return accumulator.bindings.length ? accumulator.bindings.slice(0, MAX_BINDINGS) : undefined;
}

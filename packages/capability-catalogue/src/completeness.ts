// Plan completeness: what a finished plan does not do, judged from the plan's own operations and the intent the agent declared.
import { SHAPE_ITEMS } from "@extynt/action-plan";

import { declaredValues, propertyKey, readOperations, references, stringField, targetString } from "./completeness-view.js";
import type { PlanOperation, PlanOperations } from "./completeness-view.js";
import { INTENT_CONCEPTS } from "./intent-concepts.js";

/** The schema version of completeness findings. */
export const COMPLETENESS_SCHEMA = "0.1" as const;

/** How many findings survive when the caller names no limit. */
export const COMPLETENESS_FINDING_LIMIT = 8;

/** What a finding is about. */
export type CompletenessCode =
  | "CREATED_UNUSED_OBJECT"
  | "INVISIBLE_SHAPE_ITEM"
  | "CREATED_THEN_REMOVED"
  | "SUPERSEDED_STATIC_WRITE"
  | "INTENT_CONCEPT_UNTOUCHED"
  | "INTENT_CONCEPT_UNKNOWN";

/** One advisory finding: `operationIndexes` are the plan positions it is about (empty only for an intent finding) and `message` names the operation, what is missing and the fix, in the same voice as a refusal. */
export interface CompletenessFinding {
  code: CompletenessCode;
  operationIndexes: number[];
  message: string;
}

/** `declaredConcepts` are concepts the agent says it intended, drawn from the intent vocabulary: only a declared word with no matching operation is reported. `limit` bounds the output. */
export interface CompletenessOptions {
  declaredConcepts?: readonly string[];
  limit?: number;
}

/** Every completeness finding for one plan, bounded and in plan order; findings are advisory and never change whether a plan runs. */
export function planCompleteness(plan: PlanOperations, options: CompletenessOptions = {}): CompletenessFinding[] {
  const operations = readOperations(plan);
  if (!operations.length) return [];
  const findings = [
    ...createdUnusedObjectFindings(operations),
    ...invisibleShapeItemFindings(operations),
    ...createdThenRemovedFindings(operations),
    ...supersededStaticWriteFindings(operations),
    ...intentConceptFindings(operations, options.declaredConcepts ?? []),
  ];
  const limit = Math.max(1, options.limit ?? COMPLETENESS_FINDING_LIMIT);
  return findings.sort((a, b) => (a.operationIndexes[0] ?? Number.POSITIVE_INFINITY) - (b.operationIndexes[0] ?? Number.POSITIVE_INFINITY)).slice(0, limit);
}

const finding = (code: CompletenessCode, operationIndexes: number[], message: string): CompletenessFinding => ({ code, operationIndexes, message });

function referencesByPlaceholder(operations: readonly PlanOperation[]): Map<string, number[]> {
  const referenced = new Map<string, number[]>();
  for (const operation of operations) for (const id of references(operation)) referenced.set(id, [...(referenced.get(id) ?? []), operation.index]);
  return referenced;
}

function declarationsByPlaceholder(operations: readonly PlanOperation[]): Map<string, PlanOperation> {
  const declared = new Map<string, PlanOperation>();
  for (const operation of operations) for (const id of declaredValues(operation)) declared.set(id, operation);
  return declared;
}

function removedLayerIndexes(operations: readonly PlanOperation[]): Map<string, number> {
  const removed = new Map<string, number>();
  for (const operation of operations) {
    if (operation.type !== "remove_layer") continue;
    const layerId = targetString(operation, "layerId");
    if (layerId) removed.set(layerId, operation.index);
  }
  return removed;
}

const UNUSED_DECLARATION_RULES: ReadonlyArray<{ applies: (declaration: PlanOperation) => boolean; message: (declaration: PlanOperation) => string }> = [
  { applies: (declaration) => declaration.type === "create_shape_group", message: (declaration) => `create_shape_group at index ${declaration.index} creates a group that no operation adds a path, paint or operator to, so it draws nothing. Add its contents, or remove it.` },
  { applies: (declaration) => declaration.type === "create_composition", message: (declaration) => `create_composition at index ${declaration.index} creates a composition that no operation adds a layer to or otherwise addresses. Add its contents, or remove it.` },
  { applies: (declaration) => declaration.type === "import_file", message: (declaration) => `import_file at index ${declaration.index} imports an item that no layer or operation uses. Use it as a sourceItemId, or drop the import.` },
  { applies: (declaration) => declaration.type === "create_layer" && declaration.operation.layerType === "null", message: (declaration) => `create_layer at index ${declaration.index} creates a null layer that nothing parents to, marks, or otherwise references; a null draws nothing, so it does nothing. Reference it, or remove it.` },
];

function createdUnusedObjectFindings(operations: readonly PlanOperation[]): CompletenessFinding[] {
  const referenced = referencesByPlaceholder(operations);
  const declared = declarationsByPlaceholder(operations);
  const found: CompletenessFinding[] = [];
  for (const [id, declaration] of declared) {
    const users = (referenced.get(id) ?? []).filter((index) => index !== declaration.index);
    if (users.length) continue;
    const rule = UNUSED_DECLARATION_RULES.find((candidate) => candidate.applies(declaration));
    if (rule) found.push(finding("CREATED_UNUSED_OBJECT", [declaration.index], rule.message(declaration)));
  }
  return found;
}

function recordGroupPaint(paintByGroup: Map<string, number[]>, groupId: string | undefined, index: number): void {
  if (groupId) paintByGroup.set(groupId, [...(paintByGroup.get(groupId) ?? []), index]);
}

function recordCreatedGroup(createdGroups: Map<string, number>, groupId: string | undefined, index: number): void {
  if (groupId) createdGroups.set(groupId, index);
}

function recordPrimitiveItem(primitiveItems: Array<{ groupId: string; index: number }>, groupId: string | undefined, index: number): void {
  if (groupId) primitiveItems.push({ groupId, index });
}

function recordShapeItemFacts(paintByGroup: Map<string, number[]>, primitiveItems: Array<{ groupId: string; index: number }>, operation: PlanOperation): void {
  const groupId = stringField(operation.operation, "groupId");
  const item = stringField(operation.operation, "item");
  const spec = Object.entries(SHAPE_ITEMS).find(([name]) => name === item)?.[1];
  if (spec?.family === "gradient") recordGroupPaint(paintByGroup, groupId, operation.index);
  else if (spec?.family === "primitive") recordPrimitiveItem(primitiveItems, groupId, operation.index);
}

function shapeGroupFacts(operations: readonly PlanOperation[]): { createdGroups: Map<string, number>; paintByGroup: Map<string, number[]>; primitiveItems: Array<{ groupId: string; index: number }> } {
  const createdGroups = new Map<string, number>();
  const paintByGroup = new Map<string, number[]>();
  const primitiveItems: Array<{ groupId: string; index: number }> = [];
  for (const operation of operations) {
    if (operation.type === "ensure_shape_fill" || operation.type === "ensure_shape_stroke") { recordGroupPaint(paintByGroup, stringField(operation.operation, "groupId"), operation.index); continue; }
    if (operation.type === "create_shape_group") { recordCreatedGroup(createdGroups, stringField(operation.operation, "newGroupId"), operation.index); continue; }
    if (operation.type === "add_shape_item") recordShapeItemFacts(paintByGroup, primitiveItems, operation);
  }
  return { createdGroups, paintByGroup, primitiveItems };
}

function invisibleShapeItemFindings(operations: readonly PlanOperation[]): CompletenessFinding[] {
  const { createdGroups, paintByGroup, primitiveItems } = shapeGroupFacts(operations);
  const found: CompletenessFinding[] = [];
  for (const { groupId, index } of primitiveItems) {
    if (!createdGroups.has(groupId) || paintByGroup.has(groupId)) continue;
    found.push(finding("INVISIBLE_SHAPE_ITEM", [index], `add_shape_item at index ${index} adds a path to the group created at index ${createdGroups.get(groupId)} with no fill or stroke in this plan, so it renders nothing. Add ensure_shape_fill or ensure_shape_stroke for that group.`));
  }
  return found;
}

function createdThenRemovedFindings(operations: readonly PlanOperation[]): CompletenessFinding[] {
  const referenced = referencesByPlaceholder(operations);
  const declared = declarationsByPlaceholder(operations);
  const found: CompletenessFinding[] = [];
  for (const [id, removedAt] of removedLayerIndexes(operations)) {
    const declaration = declared.get(id);
    if (!declaration || declaration.index > removedAt) continue;
    const usedInBetween = (referenced.get(id) ?? []).some((index) => index > declaration.index && index < removedAt);
    if (usedInBetween) continue;
    found.push(finding("CREATED_THEN_REMOVED", [declaration.index, removedAt], `${declaration.type} at index ${declaration.index} creates ${JSON.stringify(id)} and remove_layer at index ${removedAt} removes it again; no operation between them uses it. Remove both, or keep what it was created for.`));
  }
  return found;
}

function supersededStaticWriteFindings(operations: readonly PlanOperation[]): CompletenessFinding[] {
  const found: CompletenessFinding[] = [];
  for (const operation of operations) {
    if (operation.type !== "set_layer_property" && operation.type !== "set_effect_control") continue;
    const key = propertyKey(operation);
    if (!key) continue;
    const superseded = operations.find((candidate) => candidate.index > operation.index && (candidate.type === "animate_property" || candidate.type === "animate_control") && propertyKey(candidate) === key);
    if (!superseded) continue;
    found.push(finding("SUPERSEDED_STATIC_WRITE", [operation.index, superseded.index], `${operation.type} at index ${operation.index} writes a value that ${superseded.type} at index ${superseded.index} makes unobservable. After Effects extends a property's first keyframe value backwards, so a static write before the keyframes is held at no time at all — not before the first key, and not between keys. Drop the static write, or keyframe the value the property should hold before the first key if that is what you meant.`));
  }
  return found;
}

function intentConceptFindings(operations: readonly PlanOperation[], declaredConcepts: readonly string[]): CompletenessFinding[] {
  const vocabulary = INTENT_CONCEPTS.map((concept) => concept.word);
  const known = new Set(vocabulary);
  const found: CompletenessFinding[] = [];
  for (const word of new Set(declaredConcepts)) {
    if (!known.has(word)) { found.push(finding("INTENT_CONCEPT_UNKNOWN", [], `"${word}" is not a concept this vocabulary knows, so nothing was checked for it. Declare one of: ${vocabulary.join(", ")}.`)); continue; }
    const concept = INTENT_CONCEPTS.find((candidate) => candidate.word === word);
    if (!concept) continue;
    if (operations.some((operation) => concept.matches(operation))) continue;
    found.push(finding("INTENT_CONCEPT_UNTOUCHED", [], `The plan declares "${word}" but no operation touches it. Add the work, or drop the declaration.`));
  }
  return found;
}

// The plan read as a whole: its vocabulary, its declarations, and the cross-operation findings that no per-operation check can see.
import { planCompleteness } from "@extynt/capability-catalogue";
import type { ActionPlan, ActionPlanV2Operation } from "@extynt/action-plan";
import type { StoredPlan } from "./contracts.js";
import { asObject, arrayAt, jsonItems, jsonRecordOf, objectAt, objectOf, stringAt } from "./json.js";
import { isJsonArray } from "@extynt/decode";
import type { JsonArray, JsonObject, JsonValue } from "@extynt/decode";
import { operationJson } from "./operations.js";
import { DECLARES, declaredBindings, declaredNames, isCanonicalName } from "./placeholders.js";
import type { PlanProblem } from "./plan-problem.js";

type PlanNote = { code: string; operationIndexes: number[]; message: string };

/** The slice of a stored plan that counting its operations reads. */
export type PlanOperationSource = Pick<StoredPlan, "staged"> & { plan: { operations?: ReadonlyArray<{ readonly type: string }> } };

const POSITION_PATH = "ADBE Transform Group/ADBE Position";
const PLACEHOLDER_PREFIX = "__new__:";
const MAX_UNRESOLVED = 6;

const PLACEHOLDER_KINDS: Readonly<Record<string, string>> = { create_layer: "layer", duplicate_layer: "layer", derive_layer: "layer", create_composition: "comp", duplicate_composition: "comp", precompose_layers: "comp", create_folder: "folder", import_file: "item", create_vector_artwork: "item", add_mask: "mask", create_shape_group: "shape", add_text_animator: "animator", add_shape_item: "shapeitem" };

const POSITION_THEN_PARENT_NOTE = "Position written before set_layer_parent is in composition space; After Effects keeps the layer where it is and rewrites its local Position.";

function rewriteSettledNames(value: JsonValue, real: Readonly<Record<string, string>>): JsonValue {
  if (typeof value === "string") return Object.hasOwn(real, value) ? (real[value] ?? value) : value;
  if (isJsonArray(value)) return value.map((entry) => rewriteSettledNames(entry, real));
  const fields = jsonRecordOf(value);
  if (!fields) return value;
  return objectOf(Object.fromEntries(Object.entries(fields).map(([key, entry]) => [key, rewriteSettledNames(entry, real)])));
}

/** Replaces a `__new__:` placeholder with the id After Effects assigned once its batch settled, because a placeholder resolves inside one apply command only. */
export function resolveSettledBatchNames(operations: JsonArray, real: Readonly<Record<string, string>>): JsonArray {
  if (!Object.keys(real).length) return operations;
  return operations.map((operation) => rewriteSettledNames(operation, real));
}

/** The operations a stored plan holds: its staged batches, or the plan's own list when nothing was staged. */
export function planOperations(record: PlanOperationSource): JsonArray {
  const staged = record.staged ?? [];
  if (staged.length) return jsonItems(staged.flatMap((entry) => entry.operations));
  return jsonItems(record.plan.operations ?? []);
}

/** The operations as the caller wrote them, batch after batch. */
export function authoredOperations(record: StoredPlan): JsonArray {
  return jsonItems((record.staged ?? []).flatMap((entry) => entry.authored));
}

/** How many operations a stored plan holds. */
export function planOperationCount(record: PlanOperationSource): number {
  return planOperations(record).length;
}

/** The plan's own vocabulary: the names its operations declared, mapped to the canonical ids it uses. Only genuine aliases are carried, because a name equal to its canonical id would make the composer treat a caller's spelling as the id it must mint. */
export function vocabulary(record: StoredPlan): Record<string, string> {
  const pairs = planOperations(record).map((operation) => ({ raw: operation, stored: operation }));
  const known = { ...(record.placeholderBindings ?? {}), ...declaredBindings(pairs) };
  return Object.fromEntries(Object.entries(known).filter(([name, canonical]) => name !== canonical));
}

/** The caller's own spelling of an incoming operation, before the composer rewrites it. */
export function submittedOperation(operation: JsonValue): JsonValue {
  return structuredClone(operation);
}

/** References a plan makes that no operation in it declares. They are reported, never refused, while authoring, because building a plan in pieces names objects before it creates them; at complete they are a real problem and `planProblems` catches them. */
export function unresolvedReferences(plan: ActionPlan): string[] {
  const operations = plan.operations.map(operationJson);
  const declared = new Set(operations.flatMap(declaredNames));
  const found: string[] = [];
  operations.forEach((operation, index) => {
    for (const match of JSON.stringify(operation).matchAll(/__new__:[A-Za-z0-9._-]+/g)) {
      const line = `operation ${index} (${stringAt(operation, "type")}) references ${match[0]}, which no operation in the plan creates yet`;
      if (declared.has(match[0]) || found.length >= MAX_UNRESOLVED || found.includes(line)) continue;
      found.push(line);
    }
  });
  return found;
}

function declaresAnyOf(candidate: JsonValue | undefined, names: readonly string[]): boolean {
  const fields = asObject(candidate);
  return fields ? declaredNames(fields).some((name) => names.includes(name)) : false;
}

function placeholderStrings(value: JsonValue): string[] {
  if (typeof value === "string") return value.startsWith(PLACEHOLDER_PREFIX) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(placeholderStrings);
  const fields = asObject(value);
  return fields ? Object.values(fields).flatMap(placeholderStrings) : [];
}

function problemAbout(problem: PlanProblem, message: string): PlanProblem {
  return { index: problem.index, type: problem.type, code: "TARGET_NOT_FOUND", message };
}

function undeclaredProblem(problem: PlanProblem, named: readonly string[]): PlanProblem {
  return problemAbout(problem, `Operation ${problem.index} (${problem.type}) names ${named.join(", ")}, which no operation in this plan creates. A __new__ name only means something if an operation declares it — a create_layer/create_composition/duplicate_composition/duplicate_layer that introduces it — so either add that operation before this one or target an object the plan already has.`);
}

function lateDeclarationProblem(problem: PlanProblem, named: readonly string[], declaring: number): PlanProblem {
  return problemAbout(problem, `Operation ${problem.index} (${problem.type}) names ${named.join(", ")}, which operation ${declaring} creates — and operation ${declaring} comes after it. After Effects resolves a created object only in operations that come BEFORE the write that names it, so this can never run as ordered. Move the creating operation in front of this one, or target an object that already exists.`);
}

/** Decides whether a `TARGET_NOT_FOUND` is a legitimate mid-authoring state or a real error. The direction decides it: a declaring operation earlier in the accumulated plan resolves when the plan runs, while a later one, or a name no operation declares, can never run as ordered. The check covers every declaring operation, because the same ordering rule governs layers, compositions, folders, items, masks, shape groups and text animators. */
export function notYetResolvable(problem: PlanProblem, operations: JsonArray): PlanProblem {
  if (problem.code !== "TARGET_NOT_FOUND") return problem;
  const operation = asObject(operations[problem.index]);
  const own = operation ? declaredNames(operation) : [];
  const named = placeholderStrings(operation ?? null).filter((name) => !own.includes(name));
  if (!named.length) return problem;
  const declaring = operations.findIndex((candidate, index) => index > problem.index && declaresAnyOf(candidate, named));
  if (declaring >= 0) return lateDeclarationProblem(problem, named, declaring);
  const declaredEarlier = operations.some((candidate, index) => index < problem.index && declaresAnyOf(candidate, named));
  return declaredEarlier ? problem : undeclaredProblem(problem, named);
}

function layerKey(operation: JsonObject): string {
  const target = objectAt(operation, "target");
  const compositionId = stringAt(target, "compositionId") ?? "";
  const layerId = stringAt(target, "layerId") ?? "";
  return compositionId && layerId ? `${compositionId}\u0000${layerId}` : "";
}

function propertyKey(operation: JsonObject, path: string | undefined): string {
  const layer = layerKey(operation);
  return layer && path ? `${layer}\u0000${path}` : "";
}

function writesPosition(operation: JsonObject): boolean {
  const type = stringAt(operation, "type");
  if (type === "set_layer_property") return stringAt(operation, "role") === "transform.position" || stringAt(operation, "propertyPath") === POSITION_PATH;
  return type === "animate_property" && stringAt(objectAt(operation, "target"), "propertyPath") === POSITION_PATH;
}

/** Notes a Position write that a later `set_layer_parent` re-parents. Only assignment was measured, so clearing a parent is not reported. */
export function parentingCompensationNotes(operations: readonly ActionPlanV2Operation[]): PlanNote[] {
  const positionWrites: Array<{ layer: string; index: number }> = [];
  const lastParent = new Map<string, number>();
  operations.map(operationJson).forEach((operation, index) => {
    const layer = layerKey(operation);
    if (!layer) return;
    if (writesPosition(operation)) positionWrites.push({ layer, index });
    else if (stringAt(operation, "type") === "set_layer_parent" && stringAt(operation, "parentLayerId") !== undefined) lastParent.set(layer, index);
  });
  return [...lastParent].flatMap(([layer, parentIndex]) => {
    const before = positionWrites.filter((write) => write.layer === layer && write.index < parentIndex).map((write) => write.index);
    const after = positionWrites.some((write) => write.layer === layer && write.index > parentIndex);
    return before.length && !after ? [{ code: "POSITION_THEN_PARENT", operationIndexes: [...before, parentIndex], message: POSITION_THEN_PARENT_NOTE }] : [];
  });
}

function keyedProperties(operations: readonly JsonObject[]): Map<string, number> {
  const keyed = new Map<string, number>();
  operations.forEach((operation, index) => {
    if (stringAt(operation, "type") !== "animate_property" || !arrayAt(operation, "keyframes")?.length) return;
    const key = propertyKey(operation, stringAt(objectAt(operation, "target"), "propertyPath"));
    if (key && !keyed.has(key)) keyed.set(key, index);
  });
  return keyed;
}

function keyedStaticWriteProblems(operations: readonly ActionPlanV2Operation[]): PlanProblem[] {
  const fields = operations.map(operationJson);
  const keyed = keyedProperties(fields);
  return fields.flatMap((operation, index) => {
    const path = stringAt(operation, "propertyPath");
    const keyIndex = stringAt(operation, "type") === "set_layer_property" ? keyed.get(propertyKey(operation, path)) : undefined;
    if (keyIndex === undefined) return [];
    return [{
      index,
      type: "set_layer_property",
      code: "STATIC_WRITE_UNDER_KEYFRAMES",
      message: `Operation ${index} (set_layer_property) writes a static value to ${path}, and operation ${keyIndex} (animate_property) keys the same property in this batch, so After Effects reads back the keyframed value and operation ${index} can never verify. Remove operation ${index}; the first keyframe of operation ${keyIndex} states the value the property starts at.`,
    }];
  });
}

/** The cross-operation findings no per-operation check can see. */
export function crossOperationProblems(operations: readonly ActionPlanV2Operation[]): PlanProblem[] {
  return keyedStaticWriteProblems(operations);
}

function declaredNameAt(operation: JsonObject, path: string): string | undefined {
  const [head, tail] = path.split(".");
  return head && tail ? stringAt(objectAt(operation, head), tail) : undefined;
}

function pinOperation(pinned: Record<number, string>, operation: JsonObject, kind: string, first: number): number {
  const type = stringAt(operation, "type") ?? "";
  const paths = DECLARES[type] ?? [];
  paths.forEach((path, offset) => {
    const value = declaredNameAt(operation, path);
    if (value !== undefined && isCanonicalName(value, kind)) pinned[first + offset] = value;
  });
  return first + paths.length;
}

/** The canonical id every plan-wide declaration already has, keyed by declaration number. The composer counts an id as `__new__:layer<declaration number>` for the declaration's position in the whole plan, so it is pinned by position rather than minted per authoring step. Only a name already in the canonical shape pins one: `__new__:title` is the caller's own name for an object, and pinning it would put that name in the plan the host runs. */
export function pinCanonicalIds(operations: JsonArray): Record<number, string> {
  const pinned: Record<number, string> = {};
  let declarations = 0;
  for (const operation of operations) {
    const fields = asObject(operation);
    const kind = PLACEHOLDER_KINDS[stringAt(fields, "type") ?? ""];
    if (fields && kind) declarations = pinOperation(pinned, fields, kind, declarations);
  }
  return pinned;
}

/** Advisory notes from the sealed plan's own operations. Every finding has a legitimate reading, which is why these inform the agent instead of stopping it. */
export function completenessNotes(operations: readonly ActionPlanV2Operation[]): PlanNote[] {
  return [
    ...planCompleteness(operations).map((finding) => ({ code: finding.code, operationIndexes: finding.operationIndexes, message: finding.message })),
    ...parentingCompensationNotes(operations),
  ];
}

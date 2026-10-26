// The per-operation report for one staged batch: what the composer rewrote, what it refused, and why.
import type { JsonArray, JsonObject, JsonValue } from "@extynt/decode";
import { asObject, objectAt, stringAt } from "./json.js";
import { isJsonArray, isJsonObject } from "@extynt/decode";
import type { OperationChange, OperationVerdict } from "./batch.js";
import { verdictFix } from "./batch.js";
import type { PlanProblem } from "./plan-problem.js";

type OperationChanges = { changes: OperationChange[]; resolutions: OperationChange[] };

type ChangePair = { before: JsonObject; after: JsonObject; type: string };
type ResolutionWalk = { path: string; declared: ReadonlySet<string> };
type EffectTarget = { compositionId: string; layerId: string; effectPath: string };

type VerdictInput = {
  readonly submitted: JsonArray;
  readonly stored: JsonArray;
  readonly bindings: Readonly<Record<string, string>>;
  readonly problems?: readonly PlanProblem[];
  readonly corrections?: ReadonlyArray<readonly OperationChange[]>;
};

const DECLARED_FIELDS: ReadonlyMap<string, readonly string[]> = new Map([
  ["create_layer", ["target.layerId"]],
  ["duplicate_layer", ["target.newLayerId"]],
  ["derive_layer", ["target.newLayerId"]],
  ["create_composition", ["newCompositionId"]],
  ["duplicate_composition", ["newCompositionId"]],
  ["precompose_layers", ["newCompositionId", "newLayerId"]],
  ["create_folder", ["newFolderId"]],
  ["import_file", ["newItemId"]],
  ["create_vector_artwork", ["newItemId"]],
  ["add_mask", ["newMaskId"]],
  ["create_shape_group", ["newGroupId"]],
  ["add_text_animator", ["newAnimatorId"]],
  ["add_shape_item", ["newItemId"]],
]);

const MISSING_REFERENCE_CODES: ReadonlySet<string> = new Set(["TARGET_NOT_FOUND", "PROPERTY_NOT_FOUND", "MISSING_DEPENDENCY"]);
const CHANGE_LIMIT = 4;
const KEEP_NULL = 'a null component means "keep the value this component already holds"; the snapshot supplied it';

function fieldValue(operation: JsonObject, path: string): JsonValue | undefined {
  const [head = "", tail] = path.split(".");
  return tail === undefined ? operation[head] : objectAt(operation, head)?.[tail];
}

function stringsWithin(value: JsonValue | undefined): string[] {
  if (typeof value === "string") return [value];
  if (isJsonArray(value)) return value.flatMap((entry) => stringsWithin(entry));
  return isJsonObject(value) ? Object.values(value).flatMap((entry) => stringsWithin(entry)) : [];
}

function mentions(value: JsonValue, name: string): boolean {
  return stringsWithin(value).includes(name);
}

function bound(value: string): string {
  return value.length <= 64 ? value : `${value.slice(0, 61)}...`;
}

function changePairOf(raw: JsonValue, stored: JsonValue): ChangePair | undefined {
  const [before, after] = [asObject(raw), asObject(stored)];
  return before && after ? { before, after, type: stringAt(after, "type") ?? stringAt(before, "type") ?? "" } : undefined;
}

function declaredIdChanges(pair: ChangePair): OperationChange[] {
  const paths = DECLARED_FIELDS.get(pair.type) ?? [];
  return paths.flatMap((path) => {
    const [from, to] = [fieldValue(pair.before, path), fieldValue(pair.after, path)];
    const renamed = typeof from === "string" && typeof to === "string" && from !== to && from.startsWith("__new__:");
    return renamed ? [{ field: path, from, to, why: "the plan's canonical id for the object this operation creates; reuse it to address the same object again" }] : [];
  });
}

function textChanges(pair: ChangePair): OperationChange[] {
  if (pair.type !== "set_text_document" && pair.type !== "create_layer") return [];
  const [before, after] = [stringAt(pair.before, "text"), stringAt(pair.after, "text")];
  if (before === undefined || after === undefined || before === after) return [];
  return [{ field: "text", from: bound(before), to: bound(after), why: "line breaks normalized to the CR After Effects stores, so character ranges match the string the host holds" }];
}

function resolutionsIn(left: JsonValue | undefined, right: JsonValue | undefined, walk: ResolutionWalk): OperationChange[] {
  if (left === null && typeof right === "number") return [{ field: walk.path, from: null, to: right, why: KEEP_NULL }];
  if (isJsonArray(left) && isJsonArray(right)) return arrayResolutions(left, right, walk);
  return isJsonObject(left) && isJsonObject(right) ? objectResolutions(left, right, walk) : [];
}

function arrayResolutions(left: JsonArray, right: JsonArray, walk: ResolutionWalk): OperationChange[] {
  const length = Math.max(left.length, right.length);
  return Array.from({ length }, (_, index) => resolutionsIn(left[index], right[index], { ...walk, path: `${walk.path}[${index}]` })).flat();
}

function objectResolutions(left: JsonObject, right: JsonObject, walk: ResolutionWalk): OperationChange[] {
  return Object.keys(left)
    .filter((key) => !walk.declared.has(key) && key !== "target")
    .flatMap((key) => resolutionsIn(left[key], right[key], { ...walk, path: walk.path ? `${walk.path}.${key}` : key }));
}

function bindingApplies(pair: ChangePair, declared: ReadonlySet<string>, [name, canonical]: readonly [string, string]): boolean {
  return name.startsWith("__new__:") && name !== canonical && !declared.has(name) && mentions(pair.before, name) && mentions(pair.after, canonical);
}

function bindingChanges(pair: ChangePair, bindings: Readonly<Record<string, string>>, declared: ReadonlySet<string>): OperationChange[] {
  const hit = Object.entries(bindings).find((entry) => bindingApplies(pair, declared, entry));
  return hit ? [{ field: "references", from: hit[0], to: hit[1], why: "an object this run already created; the canonical id is what the plan carries" }] : [];
}

/** The rewrites between an operation as submitted and as stored, at most four of each kind. */
export function operationChanges(raw: JsonValue, stored: JsonValue, bindings: Readonly<Record<string, string>>): OperationChanges {
  const pair = changePairOf(raw, stored);
  if (!pair) return { changes: [], resolutions: [] };
  const declared = new Set((DECLARED_FIELDS.get(pair.type) ?? []).map((path) => path.split(".").pop() ?? path));
  const changes = [...declaredIdChanges(pair), ...textChanges(pair), ...bindingChanges(pair, bindings, declared)];
  return { changes: changes.slice(0, CHANGE_LIMIT), resolutions: resolutionsIn(pair.before, pair.after, { path: "", declared }).slice(0, CHANGE_LIMIT) };
}

function effectPathAgrees(own: JsonObject | undefined, wanted: EffectTarget): boolean {
  const effectPath = stringAt(own, "effectPath");
  return effectPath === undefined || effectPath === wanted.effectPath;
}

function materialises(operation: JsonValue | undefined, wanted: EffectTarget): boolean {
  const raw = asObject(operation);
  if (stringAt(raw, "type") !== "ensure_effect" || stringAt(raw, "effectPath") !== wanted.effectPath) return false;
  const own = objectAt(raw, "target");
  return stringAt(own, "compositionId") === wanted.compositionId && stringAt(own, "layerId") === wanted.layerId && effectPathAgrees(own, wanted);
}

function refusedEffectTarget(operation: JsonValue | undefined, detail: string): EffectTarget | undefined {
  if (!detail.includes("earlier ensure_effect")) return undefined;
  const target = objectAt(asObject(operation), "target");
  const effectPath = stringAt(target, "effectPath");
  return effectPath === undefined ? undefined : { compositionId: stringAt(target, "compositionId") ?? "", layerId: stringAt(target, "layerId") ?? "", effectPath };
}

function directCause(index: number, stored: JsonArray, rejected: ReadonlySet<number>, detail: string): number | undefined {
  const shape = refusedEffectTarget(stored[index], detail);
  if (!shape) return undefined;
  const earlier = stored.flatMap((operation, position) => (position < index && materialises(operation, shape) ? [position] : [])).at(-1);
  return earlier !== undefined && rejected.has(earlier) ? earlier : undefined;
}

function causesOf(problems: readonly PlanProblem[], stored: JsonArray): ReadonlyMap<number, number> {
  const rejected = new Set(problems.map((problem) => problem.index));
  const causes = new Map<number, number>();
  for (const problem of problems.filter((candidate) => MISSING_REFERENCE_CODES.has(candidate.code))) {
    const cause = directCause(problem.index, stored, rejected, problem.message);
    if (cause !== undefined) causes.set(problem.index, cause);
  }
  return causes;
}

function rootOf(causes: ReadonlyMap<number, number>, index: number): number {
  const cause = causes.get(index);
  return cause === undefined ? index : rootOf(causes, cause);
}

function changeLine(change: OperationChange, separator: string): string {
  return `${change.field}${separator}${JSON.stringify(change.from)} -> ${JSON.stringify(change.to)}`;
}

function acceptedVerdict(at: { index: number; type: string }, found: OperationChanges, corrected: readonly OperationChange[]): OperationVerdict {
  const modified = [...corrected, ...found.resolutions];
  if (modified.length) return { ...at, status: "accepted_modified", detail: [...modified, ...found.changes].map((change) => changeLine(change, ": ")).join("; "), changes: modified };
  const kept = found.changes.length ? `kept as written; ${found.changes.map((change) => changeLine(change, " ")).join("; ")}` : "kept as written";
  return { ...at, status: "accepted", detail: kept };
}

function rejectedVerdict(at: { index: number; type: string }, problem: PlanProblem, cause: number | undefined): OperationVerdict {
  const verdict: OperationVerdict = { ...at, status: "rejected", detail: problem.message, code: problem.code, fix: verdictFix(problem.code) };
  return cause === undefined ? verdict : { ...verdict, consequenceOf: cause };
}

/** The whole report for one composed plan. `submitted` and `stored` are index-aligned: the composer walks operations in order and never reorders them. */
export function acceptedVerdicts(input: VerdictInput): OperationVerdict[] {
  const problems = input.problems ?? [];
  const rejected = new Map(problems.map((problem) => [problem.index, problem]));
  const causes = causesOf(problems, input.stored);
  return input.submitted.map((raw, index) => {
    const stored = input.stored[index];
    const type = stringAt(asObject(stored), "type") ?? stringAt(asObject(raw), "type") ?? "unknown";
    const problem = rejected.get(index);
    if (problem) return rejectedVerdict({ index, type }, problem, causes.has(index) ? rootOf(causes, index) : undefined);
    return acceptedVerdict({ index, type }, operationChanges(raw, stored ?? null, input.bindings), input.corrections?.[index] ?? []);
  });
}

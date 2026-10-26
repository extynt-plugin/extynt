// Partial staging of a queue call that contains refused operations: the operations that validated and do not depend on a refused one are staged, and only the refused ones and what depends on them come back.
import type { FixRow } from "./batch-fix-entries.js";
import { asObject, objectAt, stringAt } from "./json.js";
import { isJsonArray, isJsonObject } from "@extynt/decode";
import type { JsonArray, JsonValue } from "@extynt/decode";
import { declaredNames } from "./placeholders.js";

const MAX_ROUNDS = 4;

interface PartialStage {
  readonly verdicts: FixRow[];
  readonly notes: string[];
  readonly failed: boolean;
}

interface PartialInput {
  readonly operations: JsonArray;
  readonly first: readonly FixRow[];
  readonly restore: () => void;
  readonly stage: (operations: JsonArray) => PartialStage;
}

/** The operations kept, the ones refused, those held back for depending on a refused one, and the staging that took the kept ones in. */
export interface PartialOutcome {
  readonly kept: number[];
  readonly refused: FixRow[];
  readonly dependents: number[];
  readonly stage: PartialStage;
}

interface Held {
  readonly created: Set<string>;
  readonly parented: Set<string>;
}

function childrenOf(value: JsonValue): JsonArray {
  if (isJsonArray(value)) return value;
  return isJsonObject(value) ? Object.values(value) : [];
}

function collectStrings(value: JsonValue, into: Set<string>): void {
  if (typeof value === "string") into.add(value);
  else for (const entry of childrenOf(value)) collectStrings(entry, into);
}

function layerOf(operation: JsonValue): string {
  return stringAt(objectAt(asObject(operation), "target"), "layerId") ?? "";
}

function declaredBy(operation: JsonValue): string[] {
  return declaredNames(asObject(operation) ?? {});
}

function absorb(held: Held, operation: JsonValue): void {
  for (const name of declaredBy(operation)) held.created.add(name);
  const layer = layerOf(operation);
  if (asObject(operation)?.type === "set_layer_parent" && layer) held.parented.add(layer);
}

function needsHeld(operation: JsonValue, held: Held): boolean {
  const own = new Set(declaredBy(operation));
  const named = new Set<string>();
  collectStrings(operation, named);
  return [...named].some((name) => held.created.has(name) && !own.has(name)) || held.parented.has(layerOf(operation));
}

/** Positions that cannot be staged because a held operation is something they need: one that names an id a held operation creates (in either order, since forward references are legal), or any operation on a layer whose set_layer_parent is held. Followed to a fixed point. */
export function dependentPositions(operations: JsonArray, held: ReadonlySet<number>): Set<number> {
  const all = new Set(held);
  const state: Held = { created: new Set(), parented: new Set() };
  for (const index of held) absorb(state, operations[index] ?? null);
  for (let more = true; more;) {
    const next = operations.flatMap((operation, index) => (!all.has(index) && needsHeld(operation, state) ? [index] : []));
    for (const index of next) {
      all.add(index);
      absorb(state, operations[index] ?? null);
    }
    more = next.length > 0;
  }
  for (const index of held) all.delete(index);
  return all;
}

function holdBack(row: FixRow, kept: readonly number[], refused: Map<number, FixRow>, dependents: Set<number>): void {
  const index = kept[row.index] ?? row.index;
  if ((row.detail ?? "").includes("earlier ensure_effect")) {
    dependents.add(index);
    return;
  }
  const cause = row.consequenceOf === undefined ? {} : { consequenceOf: kept[row.consequenceOf] ?? row.consequenceOf };
  refused.set(index, { ...row, index, ...cause });
}

function byIndex(left: FixRow, right: FixRow): number {
  return left.index - right.index;
}

function independentPositions(operations: JsonArray, refused: ReadonlyMap<number, FixRow>, dependents: Set<number>): number[] {
  for (const index of dependentPositions(operations, new Set([...refused.keys(), ...dependents]))) dependents.add(index);
  return operations.map((_, index) => index).filter((index) => !refused.has(index) && !dependents.has(index));
}

function outcomeOf(kept: number[], refused: ReadonlyMap<number, FixRow>, dependents: ReadonlySet<number>, stage: PartialStage): PartialOutcome {
  return { kept, refused: [...refused.values()].sort(byIndex), dependents: [...dependents].sort((left, right) => left - right), stage };
}

/** Stages every independent operation of the call, or returns `undefined` when that is unsafe: nothing is independent of the refused ones, re-staging the independent subset is itself refused, or the subset keeps shifting past the round limit. */
export function stagePartially(input: PartialInput): PartialOutcome | undefined {
  const refused = new Map<number, FixRow>();
  for (const row of input.first) if (row.status === "rejected") refused.set(row.index, row);
  const dependents = new Set<number>();
  for (let round = 0; round <= MAX_ROUNDS; round += 1) {
    const kept = independentPositions(input.operations, refused, dependents);
    if (!kept.length) break;
    input.restore();
    const stage = input.stage(kept.flatMap((index) => input.operations[index] ?? []));
    if (stage.failed) break;
    const rejected = stage.verdicts.filter((row) => row.status === "rejected");
    if (!rejected.length) return outcomeOf(kept, refused, dependents, stage);
    for (const row of rejected) holdBack(row, kept, refused, dependents);
  }
  input.restore();
  return undefined;
}

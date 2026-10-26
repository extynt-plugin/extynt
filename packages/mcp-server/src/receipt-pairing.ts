// Pairs the operations of a plan with the verification steps a host receipt reports for them, by position first and then by unambiguous identity.
import { stringAt } from "./json.js";
import { isJsonObject } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";

const TARGET_FIELDS = ["compositionId", "layerId", "itemId", "propertyPath", "effectPath"] as const;

type TargetField = (typeof TARGET_FIELDS)[number];

/** The identity fields an operation or a step names; absent fields are omitted. */
export type Targets = Partial<Record<TargetField, string>>;

/** An operation reduced to what pairing compares. */
export interface OperationSlot {
  readonly type: string;
  readonly targets: Targets;
}

/** A receipt step reduced to what pairing compares. */
export interface StepSlot {
  readonly step: JsonObject;
  readonly name: string | undefined;
  readonly targets: Targets;
}

/** The targets whose fields carry a value, in a fixed field order. */
export function targetsFrom(values: Readonly<Record<TargetField, string | undefined>>): Targets {
  const targets: Targets = {};
  for (const field of TARGET_FIELDS) {
    const value = values[field];
    if (value) targets[field] = value;
  }
  return targets;
}

/** The id a plan placeholder resolved to, or the id itself when it names an existing object. */
export function createdIdOf(value: JsonValue | undefined, created: Readonly<Record<string, string>>): string | undefined {
  return typeof value === "string" ? (created[value] ?? value) : undefined;
}

/** A receipt step reduced to its name and the identity fields it names; a puppet-pin step names its layer as the one requested. Anything but an object is no step. */
export function stepSlotOf(value: JsonValue): StepSlot | undefined {
  if (!isJsonObject(value)) return undefined;
  const requested = value.operation === "set_puppet_pins" ? stringAt(value, "requestedLayerId") : undefined;
  const targets = targetsFrom({
    compositionId: stringAt(value, "compositionId"),
    layerId: requested || stringAt(value, "layerId"),
    itemId: stringAt(value, "itemId"),
    propertyPath: stringAt(value, "propertyPath"),
    effectPath: stringAt(value, "effectPath"),
  });
  return { step: value, name: stringAt(value, "operation"), targets };
}

function contradicts(step: Targets, operation: Targets): boolean {
  return TARGET_FIELDS.some((field) => {
    const named = step[field];
    const expected = operation[field];
    return named !== undefined && expected !== undefined && !expected.startsWith("__new__:") && expected !== named;
  });
}

function fits(operation: OperationSlot, step: StepSlot | undefined, byPosition: boolean): step is StepSlot {
  if (!step) return false;
  const nameFits = step.name === operation.type || (byPosition && step.name === undefined);
  return nameFits && !contradicts(step.targets, operation.targets);
}

function onlyCandidate(candidates: ReadonlyArray<number>, index: number): number | undefined {
  if (candidates.length === 1) return candidates[0];
  return candidates.includes(index) ? index : undefined;
}

/** For each operation the step that reports it, or undefined; an operation takes the step at its own position when that fits, else the one unclaimed step that does. */
export function stepsForOperations(operations: ReadonlyArray<OperationSlot>, steps: ReadonlyArray<StepSlot | undefined>): ReadonlyArray<JsonObject | undefined> {
  const assigned: Array<JsonObject | undefined> = operations.map(() => undefined);
  const used = new Set<number>();
  operations.forEach((operation, index) => {
    const step = steps[index];
    if (!fits(operation, step, true)) return;
    assigned[index] = step.step;
    used.add(index);
  });
  operations.forEach((operation, index) => {
    if (assigned[index]) return;
    const candidates = steps.flatMap((step, position) => (!used.has(position) && fits(operation, step, false) ? [position] : []));
    const chosen = onlyCandidate(candidates, index);
    const step = chosen === undefined ? undefined : steps[chosen];
    if (chosen === undefined || !step) return;
    assigned[index] = step.step;
    used.add(chosen);
  });
  return assigned;
}

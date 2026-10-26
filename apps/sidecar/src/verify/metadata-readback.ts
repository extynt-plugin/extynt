// Reconciles a metadata read-set plan with what the host read back after applying it, so a verification can run against that readback instead of a full project read.
import type { JsonObject, JsonValue } from "@extynt/decode";
import { sameValue } from "./compare-values.js";
import type { ApplyCommand, HostSnapshot } from "./host-types.js";
import { blurSnapshot, creationSnapshot } from "./metadata-local.js";
import { planOf, targetLayerMatches } from "./metadata-plan.js";
import type { ReadSetPlan } from "./metadata-plan.js";
import { renameSnapshot } from "./metadata-rename.js";
import type { BlurTarget, CreateTarget, TargetBase } from "./metadata-shapes.js";

function renameAsked(target: TargetBase, operation: JsonObject): boolean {
  return target.desiredName === operation.name;
}

function blurAsked(target: BlurTarget, operation: JsonObject, coverage: JsonObject): boolean {
  return target.desiredValue === operation.value && operation.operation === "set_effect_control" && sameValue(target.localEffect, coverage.localEffect);
}

function creationAsked(target: CreateTarget, operation: JsonObject, coverage: JsonObject): boolean {
  const sameRequest = operation.operation === "ensure_effect" && operation.enabled === target.enabled;
  return sameRequest && sameValue(operation.initialization, target.initialization) && sameValue(target.localCreation, coverage.localCreation);
}

function everyAsked<T>(plan: ReadSetPlan, targets: ReadonlyArray<T>, asked: (target: T, operation: JsonObject) => boolean): boolean {
  return targets.every((target, index) => {
    const operation = plan.command.operations[index];
    return operation !== undefined && asked(target, operation);
  });
}

function requestsMatch(plan: ReadSetPlan): boolean {
  const { readSet } = plan.command;
  const coverage = plan.before.view.result.view.coverage;
  switch (readSet.schemaVersion) {
    case "metadata-read-set/1":
      return everyAsked(plan, readSet.targets, renameAsked);
    case "blur-control-read-set/1":
      return everyAsked(plan, readSet.targets, (target, operation) => blurAsked(target, operation, coverage));
    case "gaussian-create-read-set/1":
      return everyAsked(plan, readSet.targets, (target, operation) => creationAsked(target, operation, coverage));
  }
}

function addressed(plan: ReadSetPlan, target: TargetBase, index: number): boolean {
  const operation = plan.command.operations[index];
  if (!operation || target.operationIndex !== index) return false;
  return target.compositionId === operation.compositionId && target.layerId === operation.layerId && targetLayerMatches(target, plan.before.view.result.view.compositions);
}

function targetsMatch(plan: ReadSetPlan): boolean {
  const targets: ReadonlyArray<TargetBase> = plan.command.readSet.targets;
  return targets.every((target, index) => addressed(plan, target, index)) && requestsMatch(plan);
}

/** Whether the approved command is well formed and every target it names is, in the snapshot before it, the unlocked layer it was prepared against. */
export function metadataBeforeMatches(command: ApplyCommand, before: HostSnapshot | null): boolean {
  const plan = planOf(command, before);
  return plan !== null && targetsMatch(plan);
}

/** The snapshot a verification runs against, reconciled only from metadata the host read back after this exact approved command; null when the readback is not that. */
export function metadataReadbackSnapshot(command: ApplyCommand, readback: JsonValue | undefined, before: HostSnapshot | null, requestId: string): JsonObject | null {
  const plan = planOf(command, before);
  if (!plan || !targetsMatch(plan)) return null;
  const { readSet } = plan.command;
  switch (readSet.schemaVersion) {
    case "blur-control-read-set/1":
      return blurSnapshot(plan, readSet.targets, readback, requestId);
    case "gaussian-create-read-set/1":
      return creationSnapshot(plan, readSet.targets, readback, requestId);
    case "metadata-read-set/1":
      return renameSnapshot(plan, readback, requestId);
  }
}

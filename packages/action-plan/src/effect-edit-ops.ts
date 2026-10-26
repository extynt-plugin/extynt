// remove_effect and reorder_effect: take an effect off a layer, or move it within the layer's effect stack.
// Both address the effect by its effect path on the layer target.
import type { JsonObject } from "@extynt/decode";
import { effectTarget, type OperationContext } from "./layer-targets.js";
import type { V2TargetReference } from "./plan-types.js";
import { ACCEPTED, invalid, isIntegerInRange, isRefusal, objectsIn, rejectUnknown, targetOf, type OperationResult, type Refusal } from "./validation-primitives.js";

const MAX_STACK_INDEX = 128;

function sameEffectTarget(candidate: JsonObject | undefined, target: V2TargetReference): boolean {
  return candidate?.compositionId === target.compositionId && candidate?.layerId === target.layerId && candidate?.effectPath === target.effectPath;
}

function removedEarlier({ earlier }: OperationContext, target: V2TargetReference): boolean {
  let present = true;
  for (const op of objectsIn(earlier)) {
    if (!sameEffectTarget(targetOf(op), target)) continue;
    if (op.type === "remove_effect") present = false;
    if (op.type === "ensure_effect") present = true;
  }
  return !present;
}

function effectPresenceError(context: OperationContext, target: V2TargetReference): Refusal | undefined {
  return removedEarlier(context, target) ? invalid("TARGET_NOT_FOUND", `${String(context.operation.type)}: ${target.effectPath} was removed earlier in this plan.`) : undefined;
}

/** Validates remove_effect. The host resolves the path against the live stack, so an effect the snapshot does not list (a rig controller) works too, and refuses with EFFECT_NOT_FOUND when it is not there; an effect this plan removes cannot be addressed again until an ensure_effect adds it. */
export function validateRemoveEffect(context: OperationContext): OperationResult {
  const { operation } = context;
  const unknown = rejectUnknown(operation, ["type", "target", "destructive"]);
  if (unknown) return unknown;
  const target = effectTarget(context);
  if (isRefusal(target)) return target;
  if (operation.destructive !== true) return invalid("DESTRUCTIVE_CONFIRMATION_REQUIRED", "remove_effect requires destructive:true.");
  return effectPresenceError(context, target) ?? ACCEPTED;
}

/** Validates reorder_effect. Effects apply top to bottom, so index 1 is the top of the stack. */
export function validateReorderEffect(context: OperationContext): OperationResult {
  const { operation } = context;
  const unknown = rejectUnknown(operation, ["type", "target", "index"]);
  if (unknown) return unknown;
  const target = effectTarget(context);
  if (isRefusal(target)) return target;
  if (!isIntegerInRange(operation.index, 1, MAX_STACK_INDEX)) return invalid("INVALID_VALUE", `reorder_effect index is the 1-based place in the effect stack (1 = top), a whole number up to ${MAX_STACK_INDEX}.`);
  return effectPresenceError(context, target) ?? ACCEPTED;
}

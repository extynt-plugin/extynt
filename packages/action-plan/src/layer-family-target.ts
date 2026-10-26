// The target step every fixed-field layer family shares: unknown fields are refused first, then the exact current layer target,
// then the layer's existence in the snapshot or an earlier operation.
import { currentLayerTarget, plannedOrObservedLayer, type OperationContext } from "./layer-targets.js";
import type { V2TargetReference } from "./plan-types.js";
import { isRefusal, rejectUnknown, type Refusal } from "./validation-primitives.js";

/** How one layer family words its refusals, and whether its target may carry an effect or property path. */
export type LayerFamilyTarget = { readonly bare: boolean; readonly stale: string; readonly missing: string };

/** The family's layer target, or the first refusal: an unknown field, a stale or inexact target, or a layer that does not exist. */
export function familyLayerTarget(context: OperationContext, allowed: readonly string[], family: LayerFamilyTarget): V2TargetReference | Refusal {
  const unknownField = rejectUnknown(context.operation, allowed);
  if (unknownField) return unknownField;
  const target = currentLayerTarget(context.operation, context.plan, family.bare, family.stale);
  if (isRefusal(target)) return target;
  return plannedOrObservedLayer(context, target, family.missing) ?? target;
}

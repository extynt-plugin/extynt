// The verdict for a property row the fresh read does not hold: removed later in the plan, cut off by the read's limit, or truly absent.
import { failedStep, unverifiedStep } from "./verdicts.js";
import type { VerifiedStep } from "./verdicts.js";
import { firstLaterIndex, layerWhere } from "./verify-context.js";
import type { LayerState } from "./verify-context.js";

function removedLaterInPlan(state: LayerState, path: string): boolean {
  return firstLaterIndex(state.ctx, state.index, ({ step, request }) => {
    const removed = step.effectPath;
    const sameLayer = step.compositionId === state.step.compositionId && step.layerId === state.step.layerId;
    return request.operation === "remove_effect" && sameLayer && removed !== undefined && (path === removed || path.startsWith(`${removed}/`));
  }) >= 0;
}

/** Why the layer holds no row at `path`: its effect is removed later in the plan, the read was cut short, or the row is absent. */
export function missingPropertyVerdict(state: LayerState, path: string | undefined, removedReason: string): VerifiedStep {
  const kind = state.request.operation;
  const where = { ...layerWhere(state), propertyPath: path ?? null };
  if (path !== undefined && removedLaterInPlan(state, path)) return unverifiedStep(kind, "effect-removed-later-in-plan", { ...where, reason: removedReason });
  if (state.layer.propertyPathsTruncated === true) return unverifiedStep(kind, "property-path-not-in-truncated-layer-snapshot", where);
  return failedStep(kind, "property-path-missing", where);
}

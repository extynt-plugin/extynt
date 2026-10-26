// One property operation as its verifiers see it: the layer state, the row the fresh read holds at the property's path, and the ids every verdict names.
import { layerWhere, propertyOf } from "./verify-context.js";
import type { LayerState } from "./verify-context.js";
import type { SnapshotProperty } from "./snapshot-reply.js";

/** A property operation whose row is in the fresh read. */
export interface PropertyCall {
  readonly state: LayerState;
  readonly property: SnapshotProperty;
  readonly where: { readonly compositionId: string; readonly layerId: string; readonly propertyPath: string };
}

/** The path a property operation addresses: the effect for ensure_effect, else the property. */
export function propertyPathOf(state: LayerState): string | undefined {
  return state.request.operation === "ensure_effect" ? state.request.effectPath : state.request.propertyPath;
}

/** The call for a layer state whose property row is present, else null. */
export function propertyCallOf(state: LayerState, path: string): PropertyCall | null {
  const property = propertyOf(state.layer, path);
  return property ? { state, property, where: { ...layerWhere(state), propertyPath: path } } : null;
}

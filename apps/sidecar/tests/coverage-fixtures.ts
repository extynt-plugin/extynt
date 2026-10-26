// Synthetic snapshots and executed steps for the request-coverage and ae_check_request tests: layers, properties and effects built from a few fields.
import { createSnapshot, representativeSnapshot } from "@extynt/project-graph";
import type { KeyframeSnapshot, LayerSnapshot, ProjectSnapshot, PropertySnapshot } from "@extynt/project-graph";
import { type JsonValue } from "@extynt/decode";
import { appliedFacts } from "../src/request-applied.js";

/** An executed operation as the workflow records it. */
export interface Step {
  type: string;
  payload: JsonValue;
}

/** A step of the given type with the given payload. */
export const step = (type: string, payload: JsonValue = {}): Step => ({ type, payload });

/** The facts coverage reads from steps. */
export const factsOf = (steps: readonly Step[]) => appliedFacts(steps);

/** A numeric property at a path, with any fields the caller overrides. */
export const property = (path: string, extra: Partial<PropertySnapshot> = {}): PropertySnapshot => ({ path, matchName: path.split("/").at(-1) ?? path, displayName: path, kind: "property", valueType: "number", value: 0, canSetValue: true, ...extra });

/** An effect on a layer, by match name. */
export const effect = (matchName: string): PropertySnapshot => ({ ...property(`ADBE Effect Parade/${matchName}`), kind: "effect", valueType: "unknown", children: [] });

/** A keyframe at a time. */
export const key = (time: number, value: JsonValue): KeyframeSnapshot => ({ time, value });

/** A layer named for its id, with any fields the caller overrides. */
export const layer = (id: string, extra: Partial<LayerSnapshot> = {}): LayerSnapshot => ({ id, index: 1, name: id, type: "av", enabled: true, shy: false, solo: false, locked: false, startTime: 0, inPoint: 0, outPoint: 10, stretch: 100, parentId: null, matteLayerId: null, matteType: "none", isSelected: false, sourceId: null, properties: [], ...extra });

/** A one-composition project holding the layers, with an optional marker count. */
export function snapshotOf(layers: readonly LayerSnapshot[], markers = 0): ProjectSnapshot {
  const compositions = representativeSnapshot.compositions.slice(0, 1).map((composition) => ({ ...composition, layers: [...layers], ...(markers ? { markers: { count: markers, markers: [] } } : {}) }));
  return createSnapshot({ ...representativeSnapshot, compositions });
}

/** A one-composition project with the given composition name and plain layers of the given names. */
export function namedSnapshot(composition: string, names: readonly string[]): ProjectSnapshot {
  const compositions = representativeSnapshot.compositions.slice(0, 1).map((base) => ({ ...base, name: composition, layers: names.map((name) => layer(name)) }));
  return createSnapshot({ ...representativeSnapshot, compositions });
}

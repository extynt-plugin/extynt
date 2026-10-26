// The wire shape of the compositions in a probe snapshot, decoded once per layer so a layer that is read again is the same object and keeps its normalised form.
import { array, boolean, decode, type Decoder, fallback, type Infer, type JsonValue, lazy, map, nullable, nullValue, number, object, optional, record, string, union } from "@extynt/decode";
import { freezeDeep } from "@extynt/project-graph";

function list<T>(item: Decoder<T>): Decoder<T[]> {
  return map(array(item), (items) => [...items]);
}

const jsonValue: Decoder<JsonValue> = lazy(() => union(nullValue, boolean(), number(), string(), list(jsonValue), map(record(string(), jsonValue), (fields) => ({ ...fields }))));

const rawProperty = object({
  path: optional(string()),
  matchName: optional(string()),
  displayName: optional(string()),
  kind: optional(string()),
  valueType: optional(string()),
  value: optional(jsonValue),
  canSetValue: optional(boolean()),
  expression: optional(nullable(string())),
  expressionEnabled: optional(boolean()),
  keyframeCount: optional(number()),
  keyDigest: optional(string()),
  hidden: optional(boolean()),
  animatable: optional(boolean()),
  enabled: optional(boolean()),
});

/** A property row as the host reports it; every field the host may leave out is optional. */
export type RawProperty = Infer<typeof rawProperty>;

const rawLayer = object({
  id: string(),
  index: number(),
  name: string(),
  label: optional(number()),
  type: optional(string()),
  enabled: optional(boolean()),
  shy: optional(boolean()),
  solo: optional(boolean()),
  locked: optional(boolean()),
  startTime: optional(number()),
  inPoint: optional(number()),
  outPoint: optional(number()),
  stretch: optional(number()),
  parentId: optional(nullable(string())),
  matteLayerId: optional(nullable(string())),
  matteType: optional(string()),
  selected: optional(boolean()),
  isSelected: optional(boolean()),
  sourceId: optional(nullable(string())),
  compositionSourceId: optional(nullable(string())),
  propertyPaths: optional(array(rawProperty)),
});

/** A layer row as the host reports it. */
export type RawLayer = Infer<typeof rawLayer>;

const decodedLayers = new WeakMap<WeakKey, RawLayer>();

const memoisedLayer: Decoder<RawLayer> = {
  run(input) {
    const known = typeof input === "object" && input !== null ? decodedLayers.get(input) : undefined;
    if (known) return known;
    const result = decode(rawLayer, input);
    if (!result.ok) return rawLayer.run(input);
    if (typeof input === "object" && input !== null) decodedLayers.set(freezeDeep(input), result.value);
    return result.value;
  },
};

const rawMarker = object({
  time: number(),
  comment: optional(string()),
  duration: optional(number()),
  chapter: optional(nullable(string())),
  url: optional(nullable(string())),
  cuePointName: optional(nullable(string())),
  label: optional(number()),
});

/** Decodes one composition row, its layers and properties; a layer already decoded comes back as the same object. */
export const probeComposition = object({
  itemIndex: optional(number()),
  id: string(),
  name: string(),
  backgroundColor: optional(array(number())),
  width: number(),
  height: number(),
  pixelAspect: optional(number()),
  duration: number(),
  frameRate: number(),
  workAreaStart: optional(number()),
  workAreaDuration: optional(number()),
  motionBlur: optional(fallback(boolean(), undefined)),
  shutterAngle: optional(fallback(number(), undefined)),
  shutterPhase: optional(fallback(number(), undefined)),
  motionBlurSamplesPerFrame: optional(fallback(number(), undefined)),
  motionBlurAdaptiveSampleLimit: optional(fallback(number(), undefined)),
  frameBlending: optional(boolean()),
  draft3d: optional(boolean()),
  resolutionFactor: optional(array(number())),
  renderer: optional(fallback(string(), undefined)),
  renderers: optional(fallback(map(array(fallback(string(), undefined)), (names) => names.filter((name): name is string => name !== undefined)), undefined)),
  markers: optional(fallback(object({ count: number(), markers: list(rawMarker), truncated: optional(boolean()) }), undefined)),
  currentTime: optional(number()),
  layers: array(memoisedLayer),
});

/** A composition row as the host reports it, its layers decoded and remembered. */
export type RawComposition = Infer<typeof probeComposition>;

// The decoders for a host project snapshot: the envelope the sidecar reads after an apply, its compositions, layers, property paths, items and markers.
import { array, boolean, decode, decodeJson, fallback, jsonValue, nullable, number, object, optional, record, skippingInvalid, string, union } from "@extynt/decode";
import type { DecodeResult, Decoder, Infer } from "@extynt/decode";

const shapeKeys = object({ times: array(number()), vertexCounts: array(number()), truncated: optional(fallback(boolean(), undefined)) });

const propertyPath = object({
  path: optional(fallback(string(), undefined)),
  displayName: optional(fallback(string(), undefined)),
  value: optional(fallback(jsonValue, undefined)),
  enabled: optional(fallback(boolean(), undefined)),
  keyframeCount: optional(fallback(number(), undefined)),
  expressionEnabled: optional(fallback(boolean(), undefined)),
  expression: optional(fallback(jsonValue, undefined)),
  keyDigest: optional(fallback(string(), undefined)),
  keyDigestTruncated: optional(fallback(boolean(), undefined)),
  shapeKeys: optional(fallback(shapeKeys, undefined)),
});

const layer = object({
  id: string(),
  name: optional(fallback(string(), undefined)),
  type: optional(fallback(string(), undefined)),
  index: optional(fallback(number(), undefined)),
  parentId: optional(fallback(nullable(string()), undefined)),
  matteLayerId: optional(fallback(nullable(string()), undefined)),
  matteType: optional(fallback(string(), undefined)),
  sourceId: optional(fallback(nullable(string()), undefined)),
  compositionSourceId: optional(fallback(nullable(string()), undefined)),
  inPoint: optional(fallback(number(), undefined)),
  outPoint: optional(fallback(number(), undefined)),
  startTime: optional(fallback(number(), undefined)),
  stretch: optional(fallback(number(), undefined)),
  label: optional(fallback(number(), undefined)),
  enabled: optional(fallback(boolean(), undefined)),
  shy: optional(fallback(boolean(), undefined)),
  solo: optional(fallback(boolean(), undefined)),
  locked: optional(fallback(boolean(), undefined)),
  threeD: optional(fallback(boolean(), undefined)),
  audioEnabled: optional(fallback(nullable(boolean()), undefined)),
  switches: optional(fallback(record(string(), jsonValue), undefined)),
  propertyPaths: optional(fallback(skippingInvalid(propertyPath), undefined)),
  propertyPathsTruncated: optional(fallback(boolean(), undefined)),
});

const marker = object({
  time: optional(fallback(number(), undefined)),
  comment: optional(fallback(jsonValue, undefined)),
  duration: optional(fallback(jsonValue, undefined)),
  chapter: optional(fallback(jsonValue, undefined)),
  url: optional(fallback(jsonValue, undefined)),
  label: optional(fallback(jsonValue, undefined)),
  cuePointName: optional(fallback(jsonValue, undefined)),
});

/** The marker stream of a composition or a layer: how many markers it holds and the rows the host serialized. */
export const markerReading = object({ count: number(), markers: optional(fallback(skippingInvalid(marker), undefined)) });

const composition = object({
  id: string(),
  name: optional(fallback(string(), undefined)),
  layers: optional(fallback(skippingInvalid(layer), undefined)),
  truncated: optional(fallback(boolean(), undefined)),
  backgroundColor: optional(fallback(jsonValue, undefined)),
  width: optional(fallback(number(), undefined)),
  height: optional(fallback(number(), undefined)),
  pixelAspect: optional(fallback(number(), undefined)),
  duration: optional(fallback(number(), undefined)),
  frameRate: optional(fallback(number(), undefined)),
  workAreaStart: optional(fallback(number(), undefined)),
  workAreaDuration: optional(fallback(number(), undefined)),
  markers: optional(fallback(markerReading, undefined)),
  motionBlur: optional(fallback(jsonValue, undefined)),
  shutterAngle: optional(fallback(number(), undefined)),
  shutterPhase: optional(fallback(number(), undefined)),
  motionBlurSamplesPerFrame: optional(fallback(jsonValue, undefined)),
  motionBlurAdaptiveSampleLimit: optional(fallback(jsonValue, undefined)),
  frameBlending: optional(fallback(jsonValue, undefined)),
  draft3d: optional(fallback(jsonValue, undefined)),
  resolutionFactor: optional(fallback(jsonValue, undefined)),
  renderer: optional(fallback(jsonValue, undefined)),
});

const item = object({
  id: string(),
  name: optional(fallback(string(), undefined)),
  type: optional(fallback(string(), undefined)),
  parentFolderId: optional(fallback(nullable(string()), undefined)),
  compositionId: optional(fallback(nullable(string()), undefined)),
  sourceId: optional(fallback(nullable(string()), undefined)),
});

const readScope = object({ compositions: optional(fallback(string(), undefined)), items: optional(fallback(string(), undefined)) });

const snapshotResult = object({
  revision: optional(fallback(string(), undefined)),
  activeCompositionId: optional(fallback(nullable(string()), undefined)),
  currentTime: optional(fallback(nullable(number()), undefined)),
  readScope: optional(fallback(readScope, undefined)),
  compositions: optional(fallback(skippingInvalid(composition), undefined)),
  items: optional(fallback(skippingInvalid(item), undefined)),
});

const snapshotError = object({ code: optional(fallback(string(), undefined)), message: optional(fallback(string(), undefined)) });

const snapshotReply = object({
  ok: optional(fallback(boolean(), undefined)),
  requestId: optional(fallback(string(), undefined)),
  result: optional(snapshotResult),
  error: optional(fallback(nullable(snapshotError), undefined)),
  warnings: optional(fallback(array(union(string(), jsonValue)), undefined)),
});

/** One property path of a layer as the host read it. */
export type SnapshotProperty = Infer<typeof propertyPath>;
/** One layer of a composition snapshot. */
export type SnapshotLayer = Infer<typeof layer>;
/** One composition marker. */
export type SnapshotMarker = Infer<typeof marker>;
/** One composition of a snapshot with its layers. */
export type SnapshotComposition = Infer<typeof composition>;
/** One project item of a snapshot. */
export type SnapshotItem = Infer<typeof item>;
/** A decoded snapshot reply: what the host answered to a project read. */
export type SnapshotReply = Infer<typeof snapshotReply>;

const decodedValues = new WeakMap<WeakKey, SnapshotReply>();

function replyOf(decoded: DecodeResult<SnapshotReply>): SnapshotReply {
  return decoded.ok ? decoded.value : { ok: false };
}

/** Decodes the host's answer to a project read from JSON text or an already parsed value, once per parsed value; anything that is not a snapshot reply reads as a failed read, so it never fails. */
export const snapshotAnswer: Decoder<SnapshotReply> = {
  run(input) {
    if (typeof input === "string") return replyOf(decodeJson(input, snapshotReply));
    if (typeof input !== "object" || input === null) return { ok: false };
    const known = decodedValues.get(input);
    if (known) return known;
    const reply = replyOf(decode(snapshotReply, input));
    decodedValues.set(input, reply);
    return reply;
  },
};

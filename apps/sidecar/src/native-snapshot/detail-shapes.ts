/** The decoders for the `aeReadPropertyDetails` reply and the property details the details store keeps, and the types they produce. */
import { array, boolean, type Decoder, fallback, map, number, object, optional, refine, string } from "@extynt/decode";
import { opaque, type Opaque } from "../snapshot-view.js";
import { isRow, type Row } from "../snapshot-view.js";

type ShapeKeySummary = { times: readonly number[]; vertexCounts: readonly number[]; truncated?: true };
/** One property's facts from the details call: the value of a kind the plugin does not read, its keyframe digest, and for a path property the key times and vertex counts (`truncated` marks a list longer than the digest limit). */
export interface PropertyDetail { path: string; value?: Opaque; keyDigest?: string; keyDigestTruncated?: true; keyframeCount?: number; shapeKeys?: ShapeKeySummary }
export interface LayerDetails { compId: string; layerId: string; properties: readonly PropertyDetail[] }
/** A composition's own marker list (CompItem.markerProperty), as the jsx reads it: `count` is what After Effects holds, `markers` the rows read (all of them unless `truncated`). */
export type CompositionMarkers = { count: number; markers: readonly Row[]; truncated?: true };
export interface CompositionDetails { compId: string; markers: CompositionMarkers }

const numbers = array(number());
const summaryShape = object({ times: numbers, vertexCounts: numbers, truncated: optional(fallback(boolean(), undefined)) });
const aligned = refine(summaryShape, (summary): summary is typeof summary => summary.times.length === summary.vertexCounts.length, "times and vertexCounts of one length");
const shapeKeys: Decoder<ShapeKeySummary> = map(aligned, ({ times, vertexCounts, truncated }) => (truncated === true ? { times, vertexCounts, truncated } : { times, vertexCounts }));

const propertyShape = object({
  path: string({ nonEmpty: true }),
  value: optional(opaque),
  keyDigest: optional(fallback(string(), undefined)),
  keyDigestTruncated: optional(fallback(boolean(), undefined)),
  keyframeCount: optional(fallback(number(), undefined)),
  shapeKeys: optional(fallback(shapeKeys, undefined)),
});

/** One property of a details reply; a field of the wrong type reads as absent, and a value is kept only when the reply carried one. */
export const propertyDetail: Decoder<PropertyDetail> = map(propertyShape, (fact) => {
  const detail: PropertyDetail = { path: fact.path };
  if ("value" in fact) detail.value = fact.value;
  if (fact.keyDigest !== undefined) detail.keyDigest = fact.keyDigest;
  if (fact.keyDigestTruncated === true) detail.keyDigestTruncated = true;
  if (fact.keyframeCount !== undefined) detail.keyframeCount = fact.keyframeCount;
  if (fact.shapeKeys) detail.shapeKeys = fact.shapeKeys;
  return detail;
});

const layerDetails: Decoder<LayerDetails> = object({ compId: string(), layerId: string(), properties: array(propertyDetail) });
const markerRow = refine(opaque, isRow, "object");
const markersShape = object({ count: number(), markers: array(markerRow), truncated: optional(fallback(boolean(), undefined)) });
const compositionMarkers: Decoder<CompositionMarkers> = map(markersShape, ({ count, markers, truncated }) => (truncated === true ? { count, markers, truncated } : { count, markers }));
const compositionDetails: Decoder<CompositionDetails> = object({ compId: string(), markers: compositionMarkers });
const reportedError = object({ code: optional(fallback(string(), undefined)), message: optional(fallback(string(), undefined)) });

/** The details reply: `layers` and `compositions` read as null when present but malformed, and absent when the reply had none. */
export const detailsReply = object({
  ok: boolean(),
  error: optional(fallback(reportedError, undefined)),
  layers: optional(fallback(array(layerDetails), null)),
  compositions: optional(fallback(array(compositionDetails), null)),
});

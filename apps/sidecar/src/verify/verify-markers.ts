// The verdict for add, update and remove of a marker, on a layer's marker property or on the composition's own marker stream.
import { decode } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import { sameFrameTime, sameOptionValue } from "./compare-values.js";
import { numberOf } from "./json-fields.js";
import type { Request } from "./plan-request.js";
import { markerReading } from "./snapshot-reply.js";
import type { SnapshotComposition, SnapshotMarker } from "./snapshot-reply.js";
import { propertyOf } from "./verify-context.js";
import type { LayerState } from "./verify-context.js";
import { exactStep, failedStep, judged, unverifiedStep } from "./verdicts.js";
import type { Details, VerifiedStep } from "./verdicts.js";

const MARKER_FIELDS = ["comment", "duration", "chapter", "url", "cuePointName", "label"] as const satisfies ReadonlyArray<keyof Request & keyof SnapshotMarker>;

const LAYER_MARKER_PATH = "ADBE Marker";

type MarkerReading = Infer<typeof markerReading>;

interface MarkerCall {
  readonly request: Request;
  readonly reading: MarkerReading | undefined;
  readonly frameRate: number | undefined;
  readonly ids: Details;
  readonly incomplete: string;
}

function nearer(time: number, candidate: SnapshotMarker, best: SnapshotMarker | null): boolean {
  return best === null || best.time === undefined || Math.abs((candidate.time ?? 0) - time) < Math.abs(best.time - time);
}

function markerAtTime(rows: ReadonlyArray<SnapshotMarker>, time: number | undefined, frameRate: number | undefined): SnapshotMarker | null {
  let best: SnapshotMarker | null = null;
  if (time === undefined) return best;
  for (const row of rows) if (row.time !== undefined && sameFrameTime(row.time, time, frameRate) && nearer(time, row, best)) best = row;
  return best;
}

function sameMarkerField(field: (typeof MARKER_FIELDS)[number], seen: SnapshotMarker, wanted: Request, frameRate: number | undefined): boolean {
  const bothTimes = numberOf(seen[field]) !== undefined && numberOf(wanted[field]) !== undefined;
  return field === "duration" && bothTimes ? sameFrameTime(seen[field], wanted[field], frameRate) : sameOptionValue(seen[field], wanted[field]);
}

function mismatchedField(marker: SnapshotMarker, request: Request, frameRate: number | undefined): string | undefined {
  return MARKER_FIELDS.find((field) => request[field] !== undefined && !sameMarkerField(field, marker, request, frameRate));
}

function markerVerdict(call: MarkerCall): VerifiedStep {
  const { request, reading, frameRate } = call;
  const kind = request.operation;
  const rows = reading?.markers;
  if (!reading || !rows || reading.count > rows.length) return unverifiedStep(kind, call.incomplete, call.ids);
  const where = { ...call.ids, time: request.time };
  const marker = markerAtTime(rows, request.time, frameRate);
  if (kind === "remove_marker") return judged(!marker, kind, { pass: "marker-absent", fail: "marker-still-present" }, where);
  if (!marker) return failedStep(kind, "marker-missing", where);
  const field = mismatchedField(marker, request, frameRate);
  return field ? failedStep(kind, "marker-field-mismatch", { ...where, field }) : exactStep(kind, "marker-fields", where);
}

/** The verdict for a marker operation that names no layer: it is read from the composition's marker stream. */
export function verifyCompositionMarker(request: Request, comp: SnapshotComposition): VerifiedStep {
  return markerVerdict({ request, reading: comp.markers, frameRate: comp.frameRate, ids: { compositionId: comp.id }, incomplete: "composition-markers-not-fully-serialized" });
}

/** The verdict for a marker operation on a layer, read from the layer's marker property. */
export function verifyLayerMarker(state: LayerState): VerifiedStep {
  const decoded = decode(markerReading, propertyOf(state.layer, LAYER_MARKER_PATH)?.value);
  const ids = { compositionId: state.comp.id, layerId: state.layer.id };
  return markerVerdict({ request: state.request, reading: decoded.ok ? decoded.value : undefined, frameRate: state.comp.frameRate, ids, incomplete: "markers-not-fully-serialized" });
}

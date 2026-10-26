// The comparison of a shape write against the bounded shape state the host read back right after it: a group, a path, a fill, a stroke or a set of vector shapes.
import type { JsonObject } from "@extynt/decode";
import { decode, fallback, object, optional } from "@extynt/decode";
import { sameNumber, sameRgbColor } from "./compare-values.js";
import { numberOf } from "./json-fields.js";
import type { Request } from "./plan-request.js";
import { pathMismatchField, shapePathDecoder } from "./shape-path.js";
import type { TextValue } from "./vector-shapes.js";
import { boundedShapeText, childrenMatch, transformMatches, vectorMismatchEvidence, vectorShapesMatch } from "./vector-shapes.js";

const pathRequest = object({ path: optional(fallback(shapePathDecoder, undefined)) });

type ShapeComparator = (request: Request, readback: JsonObject) => boolean | null;

interface EvidenceText {
  readonly expectedValue: string;
  readonly observedValue: string;
}

const NAMES = { fill: "ADBE Vector Graphic - Fill", stroke: "ADBE Vector Graphic - Stroke" } as const;

function groupMatches(request: Request, readback: JsonObject): boolean {
  const ordinal = numberOf(readback.ordinal);
  if (readback.matchName !== "ADBE Vector Group" || readback.name !== request.name || ordinal === undefined || ordinal < 1) return false;
  return childrenMatch(readback.contents, []) && transformMatches(readback.transform, undefined);
}

function pathMatches(request: Request, readback: JsonObject): boolean | null {
  const decoded = decode(pathRequest, request.row);
  const path = decoded.ok ? decoded.value.path : undefined;
  if (!path || path.vertices === undefined || path.closed === undefined) return null;
  return readback.matchName === "ADBE Vector Shape" && pathMismatchField(readback, path) === null;
}

function opacityMatches(request: Request, readback: JsonObject): boolean {
  return request.opacity === undefined || sameNumber(readback.opacity, request.opacity);
}

function fillMatches(request: Request, readback: JsonObject): boolean {
  return readback.matchName === NAMES.fill && sameRgbColor(readback.color, request.row.color) && opacityMatches(request, readback);
}

function strokeMatches(request: Request, readback: JsonObject): boolean {
  return readback.matchName === NAMES.stroke && sameRgbColor(readback.color, request.row.color) && sameNumber(readback.width, request.width) && opacityMatches(request, readback);
}

const COMPARATORS: Readonly<Record<string, ShapeComparator>> = {
  create_shape_group: groupMatches,
  set_shape_path: pathMatches,
  ensure_shape_fill: fillMatches,
  ensure_shape_stroke: strokeMatches,
  draw_vector_shapes: vectorShapesMatch,
};

/** Null when the host sent no complete read-back, false for a mismatch, true when the read-back holds the structural state requested. */
export function shapeReadbackMatches(kind: string, request: Request, readback: JsonObject | undefined): boolean | null {
  const compare = COMPARATORS[kind];
  return readback && compare ? compare(request, readback) : null;
}

/** The bounded expected and observed text of a failed shape write, so a repair row stays actionable without a full SVG path in the receipt. */
export function shapeMismatchEvidence(kind: string, request: Request, readback: JsonObject | undefined): EvidenceText {
  if (kind === "draw_vector_shapes") return vectorMismatchEvidence(request, readback);
  const row = request.row;
  const expected: TextValue = kind === "set_shape_path" ? { path: row.path ?? null } : { name: request.name ?? null, color: row.color ?? null, width: request.width ?? null, opacity: request.opacity ?? null };
  return { expectedValue: boundedShapeText(expected), observedValue: boundedShapeText(readback) };
}

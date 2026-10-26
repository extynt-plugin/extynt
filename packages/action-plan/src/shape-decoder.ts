// The decoder for a bounded Shape DTO, the serialisable form of an After Effects Shape value; its type is what the decoder produces.
import { array, boolean, number, optional, refine, strictObject, tuple, type Infer } from "@extynt/decode";

const MAX_SHAPE_POINTS = 1_000;
const MAX_SHAPE_COORDINATE = 1_000_000;

const coordinate = number({ min: -MAX_SHAPE_COORDINATE, max: MAX_SHAPE_COORDINATE });
const shapePoint = tuple(coordinate, coordinate);

const outline = strictObject({
  vertices: array(shapePoint, { minLength: 1, maxLength: MAX_SHAPE_POINTS }),
  inTangents: optional(array(shapePoint)),
  outTangents: optional(array(shapePoint)),
  closed: boolean(),
});

type Outline = Infer<typeof outline>;

function tangentsMatchVertices(path: Outline): path is Outline {
  return [path.inTangents, path.outTangents].every((tangents) => tangents === undefined || tangents.length === path.vertices.length);
}

/** A Shape DTO: 1-1000 vertices, optional in and out tangents each as long as the vertices, and a closed flag; no other field. */
export const shapePath = refine(outline, tangentsMatchVertices, "tangents as long as the vertices");

export type ShapePath = Infer<typeof shapePath>;
export type ShapePoint = Infer<typeof shapePoint>;

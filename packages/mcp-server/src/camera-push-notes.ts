/**
 * Says when a queued Position write on a camera moves it off its own viewing axis, so a push-in written as coordinates
 * is not accepted in silence. The write is kept as sent (a deliberate truck or pedestal is legitimate); the note names
 * dolly_camera, which states the move as a distance and cannot leave the axis.
 */
import { flattenProperties, type LayerSnapshot, type ProjectSnapshot } from "@extynt/project-graph";
import { arrayAt, asObject, objectAt, stringAt } from "./json.js";
import { isJsonArray, isJsonObject } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";

const POSITION_PATH = "ADBE Transform Group/ADBE Position";
const POI_PATH = "ADBE Transform Group/ADBE Anchor Point";
const POSITION_TYPES: readonly string[] = ["animate_property", "set_layer_property"];
const SAME_XY_PX = 0.5;

interface Point { readonly x: number; readonly y: number; readonly z: number }
interface CameraAxis { readonly position: Point; readonly pointOfInterest: Point }
interface WrittenPositions { readonly layerId: string; readonly compositionId: string | undefined; readonly first: Point; readonly points: readonly Point[] }

function nonEmptyString(object: JsonObject | undefined, key: string): string | undefined {
  return stringAt(object, key) || undefined;
}

function isFiniteNumber(candidate: JsonValue): candidate is number {
  return typeof candidate === "number" && Number.isFinite(candidate);
}

function pointOf(value: JsonValue | undefined): Point | undefined {
  if (!isJsonArray(value) || value.length < 2) return undefined;
  const numbers = value.filter(isFiniteNumber);
  if (numbers.length !== value.length) return undefined;
  return { x: numbers[0] ?? 0, y: numbers[1] ?? 0, z: numbers[2] ?? 0 };
}

function round(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function showPoint(point: Point): string {
  return `(${round(point.x)}, ${round(point.y)}, ${round(point.z)})`;
}

function cameraOf(snapshot: ProjectSnapshot, compositionId: string | undefined, layerId: string): LayerSnapshot | undefined {
  for (const composition of snapshot.compositions) {
    if (compositionId && composition.id !== compositionId) continue;
    const layer = composition.layers.find((candidate) => candidate.id === layerId);
    if (layer) return layer.type === "camera" ? layer : undefined;
  }
  return undefined;
}

function positionValues(operation: JsonObject): Array<JsonValue | undefined> {
  if (operation.type === "set_layer_property") return [operation.value];
  return (arrayAt(operation, "keyframes") ?? []).map((keyframe) => asObject(keyframe)?.value);
}

function writtenPositions(operation: JsonObject): WrittenPositions | undefined {
  if (!POSITION_TYPES.includes(stringAt(operation, "type") ?? "")) return undefined;
  const target = objectAt(operation, "target");
  const layerId = nonEmptyString(target, "layerId");
  if (!layerId || (nonEmptyString(target, "propertyPath") ?? nonEmptyString(operation, "propertyPath")) !== POSITION_PATH) return undefined;
  const values = positionValues(operation);
  const points = values.flatMap((entry) => pointOf(entry) ?? []);
  const [first] = points;
  if (!first || points.length !== values.length) return undefined;
  return { layerId, compositionId: nonEmptyString(target, "compositionId"), first, points };
}

function sameXy(left: Point, right: Point): boolean {
  return Math.abs(left.x - right.x) <= SAME_XY_PX && Math.abs(left.y - right.y) <= SAME_XY_PX;
}

function cameraAxis(camera: LayerSnapshot): CameraAxis | undefined {
  const properties = flattenProperties(camera.properties);
  const position = pointOf(properties.find((property) => property.path === POSITION_PATH)?.value ?? undefined);
  const pointOfInterest = pointOf(properties.find((property) => property.path === POI_PATH)?.value ?? undefined);
  return position && pointOfInterest ? { position, pointOfInterest } : undefined;
}

function noteText(input: { type: string; camera: LayerSnapshot; axis: CameraAxis; to: Point }): string {
  const { type, camera, axis, to } = input;
  const { position, pointOfInterest } = axis;
  const distance = Math.hypot(position.x - pointOfInterest.x, position.y - pointOfInterest.y, position.z - pointOfInterest.z);
  return `${type} moves ${camera.name}'s Position to x,y (${round(to.x)}, ${round(to.y)}), but the camera is at ${showPoint(position)} looking at its point of interest ${showPoint(pointOfInterest)} (${round(distance)}px away): every key leaves its viewing axis, so this slides the camera sideways instead of pushing in or pulling out. For a push-in or pull-out use dolly_camera with distances to the point of interest (it is ${round(distance)}px now; a push-in falls, a pull-out rises). Keep this write only for a deliberate truck or pedestal.`;
}

function leavesAxis(written: WrittenPositions, axis: CameraAxis): boolean {
  const sharesXy = written.points.every((point) => sameXy(point, written.first));
  return sharesXy && !written.points.some((point) => sameXy(point, axis.position));
}

function noteFor(operation: JsonValue, snapshot: ProjectSnapshot): string | undefined {
  if (!isJsonObject(operation)) return undefined;
  const written = writtenPositions(operation);
  if (!written) return undefined;
  const camera = cameraOf(snapshot, written.compositionId, written.layerId);
  const axis = camera ? cameraAxis(camera) : undefined;
  if (!camera || !axis || !leavesAxis(written, axis)) return undefined;
  return noteText({ type: stringAt(operation, "type") ?? "", camera, axis, to: written.first });
}

/** One note per queued Position write on a camera whose x,y all differ from the camera's own. */
export function cameraPushNotes(operations: ReadonlyArray<JsonValue>, snapshot: ProjectSnapshot): string[] {
  return operations.flatMap((operation) => noteFor(operation, snapshot) ?? []);
}

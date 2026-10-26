// The checks on keyframes written to a shape path: each key's vertex count against the snapshot's summary, and each key's path against the host's own read.
import { array, decode, fallback, jsonValue, number, object, optional } from "@extynt/decode";
import type { Infer, JsonValue } from "@extynt/decode";
import { KEY_TIME_TOLERANCE } from "./compare-values.js";
import type { HostStep } from "./host-step.js";
import type { Request } from "./plan-request.js";
import type { SnapshotProperty } from "./snapshot-reply.js";
import { pathMismatchField, shapePathDecoder } from "./shape-path.js";

const keyframe = object({ time: optional(fallback(number(), undefined)), value: optional(fallback(shapePathDecoder, undefined)) });
const keyframeRequest = object({ keyframes: optional(fallback(array(fallback(keyframe, undefined)), undefined)) });
const shapeKeyRow = object({ value: optional(fallback(jsonValue, undefined)) });
const shapeKeyRead = object({ shapeKeyValues: optional(fallback(array(fallback(shapeKeyRow, undefined)), undefined)) });

type Keyframe = Infer<typeof keyframe>;

interface VertexCountMismatch {
  readonly time: number;
  readonly expected: number;
  readonly observed: number | null;
}

interface KeyValueMismatch {
  readonly time: number;
  readonly field: string;
}

const keysByRequest = new WeakMap<Request, ReadonlyArray<Keyframe | undefined> | null>();

function requestedKeys(request: Request): ReadonlyArray<Keyframe | undefined> | undefined {
  const known = keysByRequest.get(request);
  if (known !== undefined) return known ?? undefined;
  const decoded = decode(keyframeRequest, request.row);
  const keys = decoded.ok ? decoded.value.keyframes : undefined;
  keysByRequest.set(request, keys ?? null);
  return keys;
}

function vertexCountOf(summary: NonNullable<SnapshotProperty["shapeKeys"]>, wanted: number): number | null {
  const at = summary.times.findIndex((candidate) => Math.abs(candidate - wanted) < KEY_TIME_TOLERANCE);
  return at < 0 ? null : (summary.vertexCounts[at] ?? null);
}

function vertexCountProblem(property: SnapshotProperty, key: Keyframe | undefined): VertexCountMismatch | null {
  const summary = property.shapeKeys, vertices = key?.value?.vertices, wanted = key?.time;
  if (!summary || wanted === undefined || !vertices) return null;
  const observed = vertexCountOf(summary, wanted);
  return observed === vertices.length ? null : { time: wanted, expected: vertices.length, observed };
}

/** The first written key whose vertex count differs from the snapshot's summary, or null when every key matches or the summary is cut short. */
export function shapeKeyMismatch(property: SnapshotProperty, request: Request): VertexCountMismatch | null {
  const keys = requestedKeys(request);
  if (!property.shapeKeys || property.shapeKeys.truncated === true || !keys) return null;
  for (const key of keys) {
    const found = vertexCountProblem(property, key);
    if (found) return found;
  }
  return null;
}

function keyValueProblem(key: Keyframe | undefined, value: JsonValue | undefined): KeyValueMismatch | null {
  if (key?.time === undefined || !key.value || value === undefined || value === null) return null;
  const field = pathMismatchField(value, key.value);
  return field ? { time: key.time, field } : null;
}

/** The first key whose path the host read back at its time differs from the requested one, or null. */
export function shapeKeyValueMismatch(step: HostStep, request: Request): KeyValueMismatch | null {
  const decoded = decode(shapeKeyRead, step.row);
  const rows = decoded.ok ? decoded.value.shapeKeyValues : undefined;
  const keys = requestedKeys(request);
  if (!rows || !keys) return null;
  for (let index = 0; index < rows.length && index < keys.length; index += 1) {
    const found = keyValueProblem(keys[index], rows[index]?.value);
    if (found) return found;
  }
  return null;
}

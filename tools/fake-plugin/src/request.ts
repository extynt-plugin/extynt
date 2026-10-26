// The request line as the fake plugin reads it: every member the protocol defines, each present only when it has the protocol's type.
import { array, boolean, lazy, literal, map, number, object, optional, rawJson, string, union } from "@extynt/decode";
import type { Decoder } from "@extynt/decode";

/** One target of `read_paths`. */
export interface PathTargetBody { readonly compId: string; readonly layerId: string; readonly path: string }

/**
 * The members of a request line (docs/native/protocol.md). A member of the wrong type reads as absent, so the op's own validation answers for
 * it; the watch intervals read a wrong type or fraction as NaN, which the range check refuses, as the plugin does.
 */
export interface RequestBody {
  readonly id?: string | number | undefined;
  readonly op?: string | undefined;
  readonly token?: string | undefined;
  readonly detail?: "structure" | "full" | undefined;
  readonly hashes?: boolean | undefined;
  readonly propertyHashes?: boolean | undefined;
  readonly maxPropertiesPerLayer?: number | undefined;
  readonly maxPropertyDepth?: number | undefined;
  readonly preExpression?: boolean | undefined;
  readonly debugFlags?: boolean | undefined;
  readonly compId?: string | undefined;
  readonly layerId?: string | undefined;
  readonly targets?: ReadonlyArray<PathTargetBody | null> | undefined;
  readonly entry?: string | undefined;
  readonly args?: string | undefined;
  readonly ops?: ReadonlyArray<RequestBody | null> | undefined;
  readonly stopOnError?: boolean | undefined;
  readonly intervalMs?: number | undefined;
  readonly stillMs?: number | undefined;
}

const absent = map(rawJson(), () => undefined);

function lenient<T>(decoder: Decoder<T>) {
  return optional(union(decoder, absent));
}

const ID_LIMIT = 9e15;

const asId = (value: string | number | undefined): string | undefined => {
  if (typeof value === "string") return value === "" ? undefined : value;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < ID_LIMIT ? String(value) : undefined;
};

const idText = map(union(string(), number(), absent), asId);

const integerOrNaN = union(map(number(), (value) => (Number.isInteger(value) ? value : Number.NaN)), map(rawJson(), () => Number.NaN));

const pathTarget = map(object({ compId: optional(idText), layerId: optional(idText), path: lenient(string()) }), (target) =>
  target.compId === undefined || target.layerId === undefined || !target.path ? null : { compId: target.compId, layerId: target.layerId, path: target.path });
const notAnObject = map(rawJson(), () => null);

/** Decodes a request line's object; non-object entries of `ops` become null so the batch can name them. */
export const requestBody: Decoder<RequestBody> = object({
  id: lenient(union(string(), number())),
  op: lenient(string()),
  token: lenient(string()),
  detail: lenient(union(literal("structure"), literal("full"))),
  hashes: lenient(boolean()),
  propertyHashes: lenient(boolean()),
  maxPropertiesPerLayer: lenient(number()),
  maxPropertyDepth: lenient(number()),
  preExpression: lenient(boolean()),
  debugFlags: lenient(boolean()),
  compId: optional(idText),
  layerId: optional(idText),
  targets: lenient(array(union(pathTarget, notAnObject))),
  entry: lenient(string()),
  args: lenient(string()),
  ops: lenient(array(union(lazy(() => requestBody), notAnObject))),
  stopOnError: lenient(boolean()),
  intervalMs: optional(integerOrNaN),
  stillMs: optional(integerOrNaN),
});

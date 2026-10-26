// Bounded JSON for events and digests: structural limits on untrusted values, order-independent signatures and the batch digest.

import { createHash } from "node:crypto";
import type { WorkflowBatchDigestInput } from "./admission-types.js";
import { assert, fail } from "./assertions.js";
import type { WorkflowEvent } from "./events.js";
import { decodeOrThrow, isJsonObject } from "@extynt/decode";
import type { Decoder, JsonValue } from "@extynt/decode";
import {
  MAX_WORKFLOW_ARRAY_ITEMS,
  MAX_WORKFLOW_EVENT_BYTES,
  MAX_WORKFLOW_ID_LENGTH,
  MAX_WORKFLOW_JSON_DEPTH,
  MAX_WORKFLOW_JSON_NODES,
  MAX_WORKFLOW_OBJECT_KEYS,
  MAX_WORKFLOW_STRING_BYTES,
  WORKFLOW_SCHEMA_VERSION,
} from "./limits.js";

interface JsonWalk {
  nodes: number;
  readonly seen: WeakSet<WeakKey>;
}

function readScalar(input: string | number | boolean | null, context: string): string | number | boolean | null {
  if (typeof input === "string") assert(Buffer.byteLength(input, "utf8") <= MAX_WORKFLOW_STRING_BYTES, "LIMIT_EXCEEDED", `${context} exceeds the string bound.`);
  if (typeof input === "number") assert(Number.isFinite(input), "INVALID_EVENT", `${context} must contain finite numbers.`);
  return input;
}

function arrayReader(context: string, depth: number, walk: JsonWalk): Decoder<JsonValue> {
  return {
    run(input) {
      assert(Array.isArray(input), "INVALID_EVENT", `${context} must be JSON-serializable.`);
      assert(input.length <= MAX_WORKFLOW_ARRAY_ITEMS, "LIMIT_EXCEEDED", `${context} exceeds the array bound.`);
      return Array.from({ length: input.length }, (_hole, index) => decodeOrThrow(jsonReader(`${context}[${index}]`, depth + 1, walk), input[index]));
    },
  };
}

function objectReader(context: string, depth: number, walk: JsonWalk): Decoder<JsonValue> {
  return {
    run(input) {
      assert(typeof input === "object" && input !== null, "INVALID_EVENT", `${context} must be JSON-serializable.`);
      assert(Object.getPrototypeOf(input) === Object.prototype || Object.getPrototypeOf(input) === null, "INVALID_EVENT", `${context} must be a plain object.`);
      const keys = Object.keys(input);
      assert(keys.length <= MAX_WORKFLOW_OBJECT_KEYS, "LIMIT_EXCEEDED", `${context} exceeds the object-key bound.`);
      return Object.fromEntries(keys.map((key) => {
        assert(Buffer.byteLength(key, "utf8") <= MAX_WORKFLOW_ID_LENGTH, "LIMIT_EXCEEDED", `${context} contains an oversized key.`);
        return [key, decodeOrThrow(jsonReader(`${context}.${key}`, depth + 1, walk), Reflect.get(input, key))];
      }));
    },
  };
}

function jsonReader(context: string, depth: number, walk: JsonWalk): Decoder<JsonValue> {
  return {
    run(input) {
      walk.nodes += 1;
      assert(walk.nodes <= MAX_WORKFLOW_JSON_NODES, "LIMIT_EXCEEDED", `${context} exceeds the JSON node bound.`);
      assert(depth <= MAX_WORKFLOW_JSON_DEPTH, "LIMIT_EXCEEDED", `${context} exceeds the JSON nesting bound.`);
      if (input === null || typeof input === "boolean" || typeof input === "string" || typeof input === "number") return readScalar(input, context);
      assert(typeof input === "object", "INVALID_EVENT", `${context} must be JSON-serializable.`);
      assert(!walk.seen.has(input), "LIMIT_EXCEEDED", `${context} contains a cycle.`);
      walk.seen.add(input);
      const read = decodeOrThrow(Array.isArray(input) ? arrayReader(context, depth, walk) : objectReader(context, depth, walk), input);
      walk.seen.delete(input);
      return read;
    },
  };
}

/**
 * Decodes any value into plain JSON that is finite, acyclic and within the node, depth, string, array and key bounds,
 * throwing a workflow error otherwise. The outermost bound a value crosses is the one reported.
 */
export function boundedJson(context = "value"): Decoder<JsonValue> {
  return jsonReader(context, 0, { nodes: 0, seen: new WeakSet() });
}

function sortedMembers(_key: string, entry: JsonValue | undefined): JsonValue {
  if (entry === undefined) return null;
  if (!isJsonObject(entry)) return entry;
  return Object.fromEntries(Object.entries(entry).sort(([left], [right]) => (left < right ? -1 : 1)));
}

/** A deterministic JSON string: object keys sorted at every depth and undefined members written as null. */
export function signature<Value>(value: Value): string {
  return JSON.stringify(value, sortedMembers);
}

function serializeFinite(value: JsonValue): string {
  try {
    return JSON.stringify(value);
  } catch {
    return fail("LIMIT_EXCEEDED", "Workflow events must be finite JSON values.");
  }
}

/** The serialized size of an event in bytes, after proving it is bounded JSON within the per-event limit. */
export function boundedEventBytes(event: WorkflowEvent): number {
  const bytes = Buffer.byteLength(serializeFinite(decodeOrThrow(boundedJson("event"), event)), "utf8");
  assert(bytes <= MAX_WORKFLOW_EVENT_BYTES, "LIMIT_EXCEEDED", "A workflow event exceeds the bounded event size.");
  return bytes;
}

/** The sha256 hex digest of a batch's canonical admitted contents. */
export function computeWorkflowBatchDigest(input: WorkflowBatchDigestInput): string {
  const { sourcePlanDigest, sourcePlanId, ...core } = input;
  const envelope = {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    ...core,
    ...(sourcePlanId === undefined ? {} : { sourcePlanId }),
    ...(sourcePlanDigest === undefined ? {} : { sourcePlanDigest }),
  };
  decodeOrThrow(boundedJson("batch digest envelope"), envelope);
  return createHash("sha256").update(signature(envelope)).digest("hex");
}

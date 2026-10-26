// Reads what the tools return and what a plan stores back as JSON objects, so tests inspect them with typed accessors.
import assert from "node:assert/strict";
import { accepts, jsonValue } from "@extynt/decode";
import { asObject, objectsIn } from "../../src/json.js";
import type { JsonObject } from "@extynt/decode";
import { callTool, planOperations } from "../../src/index.js";
import type { StoredPlan } from "../../src/index.js";

const isJsonValue = accepts(jsonValue);

/** The payload of a successful tool result as a JSON object, or `undefined` for a failure or a payload that is not an object. */
export function resultData(result: ReturnType<typeof callTool>): JsonObject | undefined {
  return result.ok && isJsonValue(result.data) ? asObject(result.data) : undefined;
}

/** The operations a plan stores, as JSON objects in order; one that is not an object reads as an empty object. */
export function storedOperations(record: StoredPlan | undefined): ReadonlyArray<JsonObject> {
  const operations = record ? planOperations(record) : [];
  return operations.map((operation) => (isJsonValue(operation) ? asObject(operation) ?? {} : {}));
}

/** The code and message of a refused tool result; fails the test when the call succeeded. */
export function refusalOf(result: ReturnType<typeof callTool>): { readonly code: string; readonly message: string } {
  assert.ok(!result.ok, "the call was refused");
  return result.error;
}

/** The payload of a tool result that must have succeeded with a JSON object; fails the test otherwise. */
export function payloadOf(result: ReturnType<typeof callTool>): JsonObject {
  assert.ok(result.ok, "the call succeeded");
  const data = resultData(result);
  assert.ok(data, "the payload is an object");
  return data;
}

/** The rows of a tool result that must have succeeded with a JSON array of objects; fails the test otherwise. */
export function rowsOf(result: ReturnType<typeof callTool>): ReadonlyArray<JsonObject> {
  assert.ok(result.ok, "the call succeeded");
  assert.ok(isJsonValue(result.data) && Array.isArray(result.data), "the payload is an array");
  return objectsIn(result.data);
}

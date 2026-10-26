/** Editable copies of the fixture snapshot, so a comparison test can change a copy and compare it with the original. */
import { decodeJson, isJsonArray, isJsonObject, jsonObject } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { makeLayer, makeResult } from "./fixtures.ts";

/** A JSON value whose containers can be edited. */
export type Draft = null | boolean | number | string | DraftArray | DraftObject;

/** An editable JSON array. */
export interface DraftArray extends Array<Draft> {}

/** An editable JSON object. */
export interface DraftObject {
  [key: string]: Draft;
}

/** The probe and native snapshots of the same project. */
export interface SnapshotPair {
  readonly probe: DraftObject;
  readonly native: DraftObject;
}

/** An editable deep copy of a JSON value. */
export function draftOf(value: JsonValue): Draft {
  if (isJsonArray(value)) return value.map(draftOf);
  return isJsonObject(value) ? draftObjectOf(value) : value;
}

/** An editable deep copy of a JSON object. */
export function draftObjectOf(row: JsonObject): DraftObject {
  const copy: DraftObject = {};
  for (const [key, field] of Object.entries(row)) copy[key] = draftOf(field);
  return copy;
}

/** The value, failing the test when it is absent. */
export function present<Value>(value: Value | null | undefined): Value {
  if (value === undefined || value === null) throw new Error("expected a value to be present");
  return value;
}

function isDraftObject(value: Draft | undefined): value is DraftObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The object under `key`, failing the test when it is not an object. */
export function objectIn(parent: DraftObject, key: string): DraftObject {
  const found = parent[key];
  if (!isDraftObject(found)) throw new Error(`expected an object under ${key}`);
  return found;
}

/** The array under `key`, failing the test when it is not an array. */
export function listIn(parent: DraftObject, key: string): DraftArray {
  const found = parent[key];
  if (!Array.isArray(found)) throw new Error(`expected an array under ${key}`);
  return found;
}

/** The objects in the array under `key`. */
export function rowsIn(parent: DraftObject, key: string): DraftObject[] {
  return listIn(parent, key).filter(isDraftObject);
}

/** The composition at `index` of a snapshot. */
export function compositionOf(snapshot: DraftObject, index = 0): DraftObject {
  return present(rowsIn(snapshot, "compositions")[index]);
}

/** The layers of the composition at `compositionIndex`. */
export function layersOf(snapshot: DraftObject, compositionIndex = 0): DraftObject[] {
  return rowsIn(compositionOf(snapshot, compositionIndex), "layers");
}

/** The layer at `index` of the first composition. */
export function layerOf(snapshot: DraftObject, index: number): DraftObject {
  return present(layersOf(snapshot)[index]);
}

/** The property entry of a layer at `path`. */
export function propertyOf(layer: DraftObject, path: string): DraftObject {
  return present(rowsIn(layer, "propertyPaths").find((candidate) => candidate.path === path));
}

/** A copy of the fixture composition under another id and name, holding `layers`. */
export function extraComposition(id: string, name: string, layers: Draft[]): DraftObject {
  return { ...compositionOf(draftObjectOf(makeResult())), id, name, layers };
}

/** An editable layer from the fixture builder. */
export function draftLayer(id: string, index: number): DraftObject {
  return draftObjectOf(makeLayer(id, index));
}

/** Two editable copies of the fixture project, to be changed apart. */
export function snapshotPair(): SnapshotPair {
  return { probe: draftObjectOf(makeResult()), native: draftObjectOf(makeResult()) };
}

/** The JSON object a report or file text holds, failing the test when it is not one. */
export function parseObject(text: string): JsonObject {
  const decoded = decodeJson(text, jsonObject);
  if (!decoded.ok) throw new Error("expected JSON text of an object");
  return decoded.value;
}

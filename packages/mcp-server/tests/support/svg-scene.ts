// Compiles SVG scenes and reads the layers, numbers and host operations they produce, so scene tests assert on typed values.
import assert from "node:assert/strict";
import { compileSvgScene, sceneLayerOperations } from "../../src/index.js";
import type { CompiledScene, CompiledSceneLayer, SceneBuildTarget } from "../../src/index.js";
import { jsonFieldsOf, objectAt, stringAt } from "../../src/json.js";
import type { JsonObject } from "@extynt/decode";

/** The value, failing the test with `what` when it is missing. */
export function present<T>(value: T | undefined, what: string): T {
  assert.ok(value !== undefined, `${what} is present`);
  return value;
}

/** The compiled scene for an SVG drawn into a canvas of the given size (the viewBox when omitted); fails the test when it does not compile. */
export function compileScene(svg: string, canvas: { readonly width?: number; readonly height?: number } = {}): CompiledScene {
  const result = compileSvgScene(svg, canvas);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.scene;
}

/** The compiled layer with this name; fails the test, listing the layers that were compiled, when there is none. */
export function layerNamed(scene: CompiledScene, name: string): CompiledSceneLayer {
  const found = scene.layers.find((entry) => entry.name === name);
  assert.ok(found, `layer ${name} was compiled; got ${scene.layers.map((entry) => entry.name).join(", ")}`);
  return found;
}

/** The layer at this position of a compiled scene; fails the test when there is none. */
export function layerAt(scene: CompiledScene, index: number): CompiledSceneLayer {
  return present(scene.layers[index], `layer ${index}`);
}

/** Asserts two number lists have the same length and agree item by item within the tolerance. */
export function closeTo(actual: ReadonlyArray<number>, expected: ReadonlyArray<number>, tolerance = 0.02): void {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert.ok(Math.abs(value - (expected[index] ?? NaN)) <= tolerance, `${JSON.stringify(actual)} ≈ ${JSON.stringify(expected)}`));
}

/** The host operations that build one compiled layer, as JSON objects in order. */
export function layerOps(layer: CompiledSceneLayer, placeholder: string, build: SceneBuildTarget, companionId?: string): ReadonlyArray<JsonObject> {
  return sceneLayerOperations(layer, placeholder, build, companionId).map((operation) => jsonFieldsOf(operation));
}

/** The operation at this position; fails the test when there is none. */
export function opAt(operations: ReadonlyArray<JsonObject>, index: number): JsonObject {
  return present(operations[index], `operation ${index}`);
}

/** The first operation of this type; fails the test when there is none. */
export function firstOp(operations: ReadonlyArray<JsonObject>, type: string): JsonObject {
  return present(operations.find((operation) => stringAt(operation, "type") === type), `a ${type} operation`);
}

/** The operations of this type, in order. */
export function opsOfType(operations: ReadonlyArray<JsonObject>, type: string): ReadonlyArray<JsonObject> {
  return operations.filter((operation) => stringAt(operation, "type") === type);
}

/** The types of the operations, in order. */
export function opTypes(operations: ReadonlyArray<JsonObject>): ReadonlyArray<string | undefined> {
  return operations.map((operation) => stringAt(operation, "type"));
}

/** The layer id an operation targets. */
export function layerIdOf(operation: JsonObject | undefined): string | undefined {
  return stringAt(objectAt(operation, "target"), "layerId");
}

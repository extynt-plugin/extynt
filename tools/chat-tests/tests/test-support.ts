/** Helpers the chat-tests tests share: a checked non-empty read, and the fixture probe decoded into the members the tests assert on. */
import assert from "node:assert/strict";
import { array, boolean, decodeJson, decodeOrThrow, nullable, number, object, string } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import { wireValue } from "@extynt/fake-plugin";
import type { CompositionAsset } from "../src/assets.js";
import type { WireValue } from "../src/wire-types.js";

/** Parses JSON text into a wire value, throwing a decode failure on malformed text. */
export function parseWire(text: string): WireValue {
  const decoded = decodeJson(text, wireValue);
  assert.ok(decoded.ok, "the text is valid JSON");
  return decoded.value;
}

/** The value, or a failed assertion naming what was missing. */
export function required<T>(value: T | undefined, what = "a value the test depends on"): T {
  assert.ok(value !== undefined, `${what} is missing`);
  return value;
}

const probeLayer = object({
  id: string(),
  index: number(),
  type: string(),
  isSelected: boolean(),
  sourceId: nullable(string()),
  propertyPaths: array(object({ path: string() })),
});

const probeComposition = object({ id: string(), width: number(), height: number(), duration: number(), frameRate: number(), layers: array(probeLayer) });

const probeResult = object({
  result: object({
    activeCompositionId: string(),
    compositions: array(probeComposition),
    selectedLayerIds: array(string()),
    sources: array(object({ id: string() })),
  }),
});

/** The fixture probe's result, as the tests read it. */
export type ProbeResult = Infer<typeof probeResult>["result"];

/** Decodes an asset's probe into the members the tests assert on. */
export function probeOf(asset: CompositionAsset): ProbeResult {
  return decodeOrThrow(probeResult, asset.probe).result;
}

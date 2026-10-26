// Test helper: reads JSON text into a typed value through the shared decoder.
import { decodeOrThrow } from "@extynt/decode";
import type { JsonValue } from "@extynt/decode";

import { jsonValue } from "../src/decoder-kit.js";

export function parseJson(text: string): JsonValue {
  return decodeOrThrow(jsonValue, JSON.parse(text));
}

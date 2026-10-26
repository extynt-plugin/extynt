// The decoder for effect-control probe evidence read from disk: tolerant of members it cannot read, strict about the shape that carries them.
import { array, boolean, map, nullValue, nullable, number, object, optional, string, union } from "@extynt/decode";
import type { Decoder, JsonValue } from "@extynt/decode";

import type { EffectProbeEffect, EffectProbeEvidence, EffectProbeRow } from "./catalogue-model.js";
import { isKept, jsonValue, list, rowsOf, skippable, softly } from "./decoder-kit.js";

const UNITS_LABEL_MAX_CHARS = 80;

function isText(item: JsonValue): item is string {
  return typeof item === "string";
}

const textsOnly: Decoder<string[]> = map(array(jsonValue), (items) => items.filter(isText));

const probeRow: Decoder<EffectProbeRow> = object({
  m: softly(string()),
  n: softly(string()),
  t: softly(nullable(string())),
  v: optional(jsonValue),
  min: softly(number()),
  max: softly(number()),
  u: softly(string({ nonEmpty: true, maxLength: UNITS_LABEL_MAX_CHARS })),
  dd: softly(boolean()),
  items: softly(union(nullValue, textsOnly)),
  static: softly(boolean()),
  hid: softly(boolean()),
  g: softly(number()),
});

const probeEffect: Decoder<EffectProbeEffect> = object({
  name: softly(string()),
  category: softly(string()),
  controls: softly(map(array(skippable(probeRow)), (rows) => rows.filter(isKept))),
});

/**
 * Decodes the effect-control probe file. A control row, effect or member that is not what the probe writes is left out;
 * a file whose `effects` is not an object is rejected.
 */
export const effectProbeEvidence: Decoder<EffectProbeEvidence> = object({
  host: softly(object({ version: softly(nullable(string())) })),
  userAssisted: softly(list(string())),
  effects: rowsOf(probeEffect),
});

// A synthetic control census, decoded like host evidence, for the tests that exercise the evidence merge; the runtime never reads it.
import { readFileSync } from "node:fs";
import { decode } from "@extynt/decode";

import { effectProbeEvidence } from "../src/index.js";
import type { EffectProbeEvidence } from "../src/index.js";

export function loadFixtureEffectEvidence(): EffectProbeEvidence | undefined {
  const result = decode(effectProbeEvidence, JSON.parse(readFileSync(new URL("../../tests/fixtures/effect-controls-ae26.json", import.meta.url), "utf8")));
  return result.ok ? result.value : undefined;
}

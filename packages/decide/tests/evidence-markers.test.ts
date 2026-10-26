// Pins that adding markers, including markers timed to a beat or downbeat, is timeline metadata: it does not make a request visual, while the same request with a motion or look stays visual.
import assert from "node:assert/strict";
import test from "node:test";
import { ASKS_PICTURE_JUDGEMENT, NEEDS_FRAME_EVIDENCE, NEEDS_MOTION_EVIDENCE } from "../src/index.js";

function evidence(goal: string): { readonly temporal: boolean; readonly visual: boolean; readonly judgement: boolean } {
  return {
    temporal: NEEDS_MOTION_EVIDENCE.deterministic({ goal }),
    visual: NEEDS_FRAME_EVIDENCE.deterministic({ goal }),
    judgement: ASKS_PICTURE_JUDGEMENT.deterministic({ goal }),
  };
}

const METADATA_ONLY = [
  "Add a marker on every downbeat of the track",
  "Add markers timed to the beat of the song",
  "Put a marker on each beat of the 120 bpm track for 8 bars",
  "Setze einen Marker auf jeden Taktschlag",
  "Añade marcadores en cada tiempo fuerte",
  "Add a marker every second",
];

test("markers, including ones timed to a beat, are not a visual outcome", () => {
  for (const goal of METADATA_ONLY) {
    assert.deepEqual(evidence(goal), { temporal: false, visual: false, judgement: false }, goal);
  }
});

test("a marker request that also moves or changes the picture stays visual", () => {
  assert.deepEqual(evidence("Add a marker timed to the downbeat and make the title bounce"), { temporal: true, visual: true, judgement: false });
  assert.deepEqual(evidence("Add a marker where the title starts to fade in"), { temporal: true, visual: true, judgement: false });
  assert.equal(evidence("Add a marker on the downbeat and make the logo glow").visual, true);
});

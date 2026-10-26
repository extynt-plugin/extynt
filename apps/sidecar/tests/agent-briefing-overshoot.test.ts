// The overshoot bands and colour-fade rule the shared values-and-units text gives the panel agent and the build kit.
import assert from "node:assert/strict";
import test from "node:test";
import { VALUES_AND_UNITS } from "../src/agent-briefing-reference.js";

test("a little or slight overshoot is 5-10% past the target, and a lot or big is 20-30%", () => {
  assert.match(VALUES_AND_UNITS, /"a little"\/"slight" 5-10% past the target/);
  assert.match(VALUES_AND_UNITS, /"a lot"\/"big" 20-30%/);
});

test("a plain overshoot keeps the default, with no band attached", () => {
  assert.match(VALUES_AND_UNITS, /"overshoot" alone keeps default/);
});

test("a colour fade is a shape Gradient Fill on a shape layer, the Gradient Ramp elsewhere, and never the solid Fill", () => {
  assert.match(VALUES_AND_UNITS, /Shapes get Gradient Fill/);
  assert.match(VALUES_AND_UNITS, /footage, solids, text get Gradient Ramp/);
  assert.match(VALUES_AND_UNITS, /never ADBE Fill/);
});

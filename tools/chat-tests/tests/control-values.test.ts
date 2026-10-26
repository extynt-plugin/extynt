/** Tests how the last write to an effect control is read back across pages and repeated siblings. */
import test from "node:test";
import assert from "node:assert/strict";
import { controlValueFailures, writtenControlValues } from "../src/control-values.js";
import type { WireValue } from "../src/wire-types.js";

const write = (path: string, value: WireValue) => ({ type: "set_effect_control", target: { layerId: "layer-title", propertyPath: path }, value });
const FRACTAL = "ADBE Effect Parade/ADBE Fractal Noise";

test("the last write to a control is the value it is left at, across pages and repeated siblings", () => {
  const pages = [JSON.stringify([write(`${FRACTAL}/ADBE Fractal Noise-0001`, 1), { type: "ensure_effect", target: { layerId: "layer-title" } }]), JSON.stringify([write(`${FRACTAL}#2/ADBE Fractal Noise-0001#2`, 3)]), "not json"];
  assert.deepEqual([...writtenControlValues(pages)], [["ADBE Fractal Noise-0001", 3]]);
});

test("a missing control, a wrong menu item and a near-equal number are told apart", () => {
  const pages = [JSON.stringify([write(`${FRACTAL}/ADBE Fractal Noise-0030`, 6), write(`${FRACTAL}/ADBE Fractal Noise-0005`, -10.0000000001), write("ADBE Effect Parade/ADBE Fill/ADBE Fill-0002", [1, 0.5, 0, 1])])];
  assert.deepEqual(controlValueFailures(pages, { "ADBE Fractal Noise-0030": 7, "ADBE Fractal Noise-0005": -10, "ADBE Fill-0002": [1, 0.5, 0, 1], "ADBE Glo2-0006": 6 }), [
    "ADBE Fractal Noise-0030 was set to 6, expected 7",
    "no operation set ADBE Glo2-0006",
  ]);
  assert.deepEqual(controlValueFailures(pages, undefined), []);
});

// The EXTYNT_SVG_FORCE_CONVERTER switch: on only when the variable is exactly 1.
import assert from "node:assert/strict";
import test from "node:test";
import { svgConverterSwitch } from "../src/svg-converter-switch.js";

test("EXTYNT_SVG_FORCE_CONVERTER=1 forces the converter and logs one line saying so", () => {
  const result = svgConverterSwitch({ EXTYNT_SVG_FORCE_CONVERTER: "1" });
  assert.equal(result.force, true);
  assert.match(result.line ?? "", /EXTYNT_SVG_FORCE_CONVERTER=1, extynt's converter builds all SVG artwork/);
});

test("the switch is off unless it is exactly 1", () => {
  for (const value of [undefined, "", "0", "true", "yes"]) assert.deepEqual(svgConverterSwitch({ EXTYNT_SVG_FORCE_CONVERTER: value }), { force: false, line: null });
});

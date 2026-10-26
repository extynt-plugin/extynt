/**
 * Host files run as ExtendScript (ES3) does: the ES5+ built-ins After Effects lacks are gone from the test scope too.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { loadHostContext } from "./host-vm-context.js";

test("the host scope has no ES5+ array, string, object or function built-ins, as in After Effects", () => {
  const { call } = loadHostContext();
  for (const probe of ["[].indexOf", "[].map", "[].forEach", "Array.isArray", "Object.keys", "''.trim", "Date.now", "(function () {}).bind"]) assert.equal(call(`typeof ${probe}`), "undefined", probe);
});

test("derive_layer's own field checks run without Array indexOf (live AE 26 failed on it)", () => {
  const { call } = loadHostContext();
  assert.equal(call(`AE_APPLY_VAL_CHECKS.deriveFields({ kind: "split", time: 1 })`), true);
  assert.equal(call(`AE_APPLY_VAL_CHECKS.deriveFields({ kind: "path-null", pointIndex: 0, pointKind: "vertex", propertyPath: "ADBE Mask Parade/ADBE Mask Atom/ADBE Mask Shape" })`), true);
  assert.equal(call(`AE_APPLY_VAL_CHECKS.deriveFields({ kind: "melt" })`), false);
});

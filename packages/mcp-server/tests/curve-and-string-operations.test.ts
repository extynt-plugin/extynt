// Tests that corrections drop curves on non-numeric keyframes and refuse duplicate keyframe times, and that operation strings are coerced into arrays without echoing their content.
import test from "node:test";
import assert from "node:assert/strict";
import { representativeSnapshot } from "@extynt/project-graph";
import { correctOperation } from "../src/compose-corrections.js";
import { withArrayArg } from "../src/queue-parse.js";
import { parseArrayText } from "../src/queue-parse.js";
import { arrayAt, asObject, objectsIn } from "../src/json.js";
import type { JsonObject, JsonValue } from "@extynt/decode";

const target = { compositionId: "comp-main", layerId: "layer-title", propertyPath: "ADBE Text Properties/ADBE Text Document" };
function animate(propertyPath: string, keyframes: JsonValue[]): JsonObject {
  return { type: "animate_property", target: { ...target, propertyPath }, keyframes };
}

test("a curve on non-numeric keyframes is dropped and said", () => {
  const raw = animate("ADBE Text Properties/ADBE Text Document", [{ time: 0, value: "A", curve: "easeInOut" }, { time: 1, value: "B" }]);
  const out = correctOperation(raw, representativeSnapshot, 0);
  assert.equal(out.refusal, undefined);
  const first = objectsIn(arrayAt(asObject(out.operation), "keyframes"))[0];
  assert.ok(first);
  assert.equal(first.curve, undefined);
  assert.equal(first.value, "A");
  assert.match(out.changes.map((change) => change.why).join(" "), /custom curve dropped: .*keyframes are not numeric/);
});

test("curves on numeric and shape-valued keyframes are kept", () => {
  const numeric = animate("ADBE Transform Group/ADBE Opacity", [{ time: 0, value: 0, curve: "easeInOut" }, { time: 1, value: 100 }]);
  assert.deepEqual(correctOperation(numeric, representativeSnapshot, 0).changes, []);
  const shape = animate("ADBE Mask Parade/ADBE Mask Atom 1/ADBE Mask Shape", [{ time: 0, value: { vertices: [[0, 0]] }, curve: "easeInOut" }, { time: 1, value: { vertices: [[1, 1]] } }]);
  assert.deepEqual(correctOperation(shape, representativeSnapshot, 0).changes, []);
});

test("two keyframes at one time are refused naming the property and time", () => {
  const raw = animate("ADBE Transform Group/ADBE Opacity", [{ time: 1.2, value: 0 }, { time: 1.2, value: 100 }]);
  const out = correctOperation(raw, representativeSnapshot, 0);
  assert.equal(out.refusal?.code, "INVALID_ARGUMENT");
  assert.match(out.refusal?.message ?? "", /two keyframes at 1\.2 s on ADBE Transform Group\/ADBE Opacity; give each a distinct time/);
});

const ops: JsonObject[] = [{ type: "add_marker", time: 1 }];
const text = JSON.stringify(ops);
test("fenced, wrapped and trailing-comma operations strings are accepted", () => {
  for (const sent of ["  " + text + "\n", "```json\n" + text + "\n```", "Here you go:\n" + text + "\nDone.", text.replace(/\]$/, ",]"), "```\n" + text.replace(/\]$/, ",\n]") + "\n```"]) {
    assert.deepEqual(withArrayArg({ operations: sent }, "operations", "operation objects"), { args: { operations: ops } }, sent);
  }
});

test("a truncated string says it was truncated; other errors give a position; no content is echoed", () => {
  const cut = withArrayArg({ operations: text.slice(0, -5) }, "operations", "operation objects");
  assert.match("error" in cut ? cut.error.message : "", /truncated.*fewer operations per call/);
  const bad = withArrayArg({ operations: '[{"type": oops}]' }, "operations", "operation objects");
  const message = "error" in bad ? bad.error.message : "";
  assert.match(message, /invalid JSON near character \d+/);
  assert.doesNotMatch(message, /oops/);
  assert.equal(parseArrayText("{}").ok, false);
});

test("real arrays are untouched", () => {
  const args: JsonObject = { operations: ops };
  assert.deepEqual(withArrayArg(args, "operations", "operation objects"), { args });
});

test("withArrayArg returns the arguments with the array read out and leaves its input alone", () => {
  const args: JsonObject = { operations: text, summary: "x" };
  assert.deepEqual(withArrayArg(args, "operations", "operation objects"), { args: { operations: ops, summary: "x" } });
  assert.equal(args.operations, text);
  const real: JsonObject = { operations: ops };
  assert.deepEqual(withArrayArg(real, "operations", "operation objects"), { args: real });
  const refused = withArrayArg({ operations: "[" }, "operations", "operation objects");
  assert.equal("error" in refused && refused.error.code, "INVALID_ARGUMENT");
});

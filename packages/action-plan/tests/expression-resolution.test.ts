// Expressions and materialised properties: set_expression resolves what earlier operations create, and loop and parse errors are refused at queue time.
import assert from "node:assert/strict";
import test from "node:test";
import type { JsonObject } from "@extynt/decode";
import { animatorPath, EMPTY_SNAPSHOT, expressionOn, newComposition, newTarget, newTextLayer } from "./fixtures.js";
import { assertSequences, GENEROUS_BOUNDS, refusal, verdict } from "./plan-builders.js";

const options = { snapshot: EMPTY_SNAPSHOT, bounds: GENEROUS_BOUNDS };
const POSITION_3D = animatorPath("ADBE Text Animator", "ADBE Text Animator Properties/ADBE Text Position 3D");
const PERCENT_START = "ADBE Text Selectors/ADBE Text Selector/ADBE Text Percent Start";
const addAnimator = { type: "add_text_animator", target: newTarget(), newAnimatorId: "__new__:anim1", properties: { position: [0, 0] }, selector: { type: "range", settings: { start: 0, end: 100 } } } satisfies JsonObject;
const addSecondAnimator = { type: "add_text_animator", target: newTarget(), newAnimatorId: "__new__:anim2", properties: { opacity: 50 }, selector: { type: "range", settings: { start: 0 } } } satisfies JsonObject;
const ensureAnimator = { type: "ensure_text_animator", target: newTarget(), role: "text.opacity", value: 100 } satisfies JsonObject;
const base = [newComposition, newTextLayer] as const;

test("set_expression resolves an animator property an earlier operation added", () => {
  assertSequences([["ok", [...base, addAnimator, expressionOn(POSITION_3D)]]], options);
});

test("animate_property resolves an animator property an earlier operation added", () => {
  const animate = { type: "animate_property", target: newTarget({ propertyPath: POSITION_3D }), keyframes: [{ time: 0, value: [0, 0, 0] }] } satisfies JsonObject;
  assertSequences([["ok", [...base, addAnimator, animate]]], options);
});

test("ensure_text_animator materialises animator one only", () => {
  assertSequences([
    ["ok", [...base, ensureAnimator, expressionOn(animatorPath("ADBE Text Animator", PERCENT_START))]],
    ["TARGET_NOT_FOUND", [...base, ensureAnimator, expressionOn(animatorPath("ADBE Text Animator#2", PERCENT_START))]],
  ], options);
});

test("a second animator the plan adds owns the ordinal two path", () => {
  assertSequences([
    ["ok", [...base, addAnimator, addSecondAnimator, expressionOn(animatorPath("ADBE Text Animator#2", PERCENT_START))]],
    ["ok", [...base, addAnimator, addSecondAnimator, expressionOn(animatorPath("ADBE Text Animator", PERCENT_START))]],
  ], options);
});

test("a property nothing materialises is refused and the canonical native path resolves", () => {
  const position = { type: "animate_property", target: newTarget({ propertyPath: "ADBE Transform Group/ADBE Position" }), keyframes: [{ time: 0, value: [960, 1400] }] } satisfies JsonObject;
  assertSequences([
    ["TARGET_NOT_FOUND", [...base, expressionOn("ADBE Transform Group/ADBE Orientation")]],
    ["ok", [...base, position]],
  ], options);
});

function expression(source: string): readonly JsonObject[] {
  const rings = { type: "create_layer", target: newTarget(), layerType: "shape", name: "Rings" } satisfies JsonObject;
  const set = { type: "set_expression", target: newTarget({ propertyPath: "ADBE Transform Group/ADBE Scale" }), enabled: true, source } satisfies JsonObject;
  return [{ ...newComposition, name: "Ident", durationSeconds: 10, frameRate: 30 }, rings, set];
}

function expressionCode(source: string): string {
  return verdict(expression(source), options);
}

test("a loop type After Effects rejects is refused with the legal spelling", () => {
  const refused = refusal(expression("loopOut('ping-pong')"), options);
  assert.equal(refused.code, "EXPRESSION_INVALID");
  assert.match(refused.message, /"pingpong"/);
});

test("legal loop expressions are accepted", () => {
  for (const source of ["loopOut('pingpong')", 'loopIn("cycle")', "loopOutDuration('offset', 2)", "loopOut()", "wiggle(2, 20)"]) assert.equal(expressionCode(source), "ok", source);
});

test("an expression that does not parse is refused", () => {
  const unparsed = refusal(expression("if (time < 0.5) wiggle(18, 0.5) else value"), options);
  assert.equal(unparsed.code, "EXPRESSION_INVALID");
  assert.match(unparsed.message, /does not parse/);
});

test("expressions that parse are accepted", () => {
  for (const source of ["time < 0.5 ? wiggle(18, 0.5) : value", "if (time < 0.5) wiggle(18, 0.5); else value", "var s = 1;\nvalue * s"]) assert.equal(expressionCode(source), "ok", source);
});

test("a function After Effects does not define is refused", () => {
  const unknownFn = refusal(expression("radToDeg(Math.atan2(1, 2))"), options);
  assert.equal(unknownFn.code, "EXPRESSION_INVALID");
  assert.match(unknownFn.message, /radToDeg is not an After Effects expression function/);
  assert.match(unknownFn.message, /radiansToDegrees\(\)/);
  assert.match(refusal(expression("fooBar(2)"), options).message, /fooBar is not an After Effects expression function/);
});

test("functions the expression defines or After Effects provides are accepted", () => {
  const allowed = ["function f(x) { return x * 2; }\nf(value)", "var g = function (x) { return x; };\ng(1)", "const h = (a, b) => a + b;\nh(1, 2)", "Math.sin(time) * 10 + thisComp.layer('A').transform.position.valueAtTime(0)[0]", "radiansToDegrees(Math.atan2(1, 2))", "// radToDeg(1)\n'radToDeg(1)'; value", "$bm_mul(value, 2)", "linear(time, 0, 1, 0, 100) + parseFloat('1')", "effect('Slider')('Slider') + thisComp.layer(1).effect('X')(1)"];
  for (const source of allowed) assert.equal(expressionCode(source), "ok", source);
});

test("marker methods that are not functions name the fix", () => {
  const rows: readonly (readonly [string, RegExp])[] = [["mk = thisComp.marker; mk.keyValue(1)", /\.key\(i\)\.value/], ["thisComp.marker.keyTime(1)", /\.key\(i\)\.time/], ["thisComp.marker.numKeys()", /a number, not a function/]];
  for (const [source, fix] of rows) {
    const refused = refusal(expression(source), options);
    assert.equal(refused.code, "EXPRESSION_INVALID", source);
    assert.match(refused.message, fix);
  }
});

test("marker properties that exist are accepted", () => {
  for (const source of ["thisComp.marker.key(1).time", "var m = thisComp.marker; m.numKeys > 0 ? m.key(\"intro\").time : 0", "thisLayer.marker.nearestKey(time).index"]) assert.equal(expressionCode(source), "ok", source);
});

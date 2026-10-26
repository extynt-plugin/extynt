// The .jsx module-wrapper rule in scripts/lib/measure.ts: a top-level IIFE is the file, its inner functions are measured.
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { functionMetrics, tokenSpans } from "../scripts/lib/measure.ts";

interface MeasureOptions {
  readonly moduleIife: boolean;
}

function metricsOf(text: string, options?: MeasureOptions) {
  const source = ts.createSourceFile("x.jsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  return functionMetrics(source, tokenSpans(source), options).map((metric) => metric.name);
}

const WRAPPED_CALL_OUTSIDE = "(function () { function inner() { return 1; } inner(); })();";
const WRAPPED_CALL_INSIDE = "(function () { function inner() { return 1; } inner(); }());";

test("a top-level IIFE is not measured as a function in .jsx mode, but its inner functions are", () => {
  assert.deepEqual(metricsOf(WRAPPED_CALL_OUTSIDE, { moduleIife: true }), ["inner"]);
  assert.deepEqual(metricsOf(WRAPPED_CALL_INSIDE, { moduleIife: true }), ["inner"]);
});

test("without the .jsx option the IIFE is an ordinary function", () => {
  assert.deepEqual(metricsOf(WRAPPED_CALL_OUTSIDE), ["<anonymous>", "inner"]);
});

test("an IIFE nested inside a function is still measured", () => {
  const text = "(function () { function outer() { return (function () { return 1; })(); } outer(); })();";
  assert.deepEqual(metricsOf(text, { moduleIife: true }), ["outer", "<anonymous>"]);
});

test("a function expression that is not called immediately is measured", () => {
  assert.deepEqual(metricsOf("var f = function () { return 1; };", { moduleIife: true }), ["<anonymous>"]);
  assert.deepEqual(metricsOf("(function () { return 1; });", { moduleIife: true }), ["<anonymous>"]);
});

test("a top-level IIFE inside a block is not the module wrapper", () => {
  assert.deepEqual(metricsOf("if (x) { (function () { return 1; })(); }", { moduleIife: true }), ["<anonymous>"]);
});

// scripts/lib/comments/extendscript-comments.ts: the header and exported-function doc policy for .jsx files.
import assert from "node:assert/strict";
import test from "node:test";
import { extendscriptCommentFailures } from "../scripts/lib/comments/extendscript-comments.ts";

const failures = (text: string) => extendscriptCommentFailures("a.jsx", text);
const lines = (found: readonly string[]) => found.map((failure: string) => Number(failure.split(":")[1]));

test("a header with global and exported declarations passes", () => {
  assert.deepEqual(failures("// Builds layers.\n/* global app, helper */\n/* exported run */\n\nfunction run() { return 1; }\n"), []);
});

test("one doc comment above an exported function passes", () => {
  const text = "// Builds layers.\n/* exported run */\n\n/** Runs it. */\nfunction run() { return 1; }\n";
  assert.deepEqual(failures(text), []);
});

test("a doc comment above a function that is not exported fails", () => {
  const text = "// Builds layers.\n/* exported run */\n\n/** Runs it. */\nfunction run() { return 1; }\n/** Helps. */\nfunction help() { return 2; }\n";
  assert.deepEqual(lines(failures(text)), [6]);
});

test("a declaration outside the header fails", () => {
  assert.deepEqual(lines(failures("// Builds layers.\nvar x = 1;\n/* global app */\n")), [3]);
});

test("a missing header fails and a comment in a body fails", () => {
  assert.deepEqual(lines(failures("/* exported run */\nfunction run() {\n  // why\n  return 1;\n}\n")), [1, 3]);
});

test("a doc comment above an exported variable assigned a wrapper passes, and above one that is not exported fails", () => {
  const text = "// Builds layers.\n/* exported aeRun */\n\n/** Runs it. */\nvar aeRun = aeEntryGuard(aeRunBody);\n/** Helps. */\nvar aeHelp = aeEntryGuard(aeHelpBody);\n";
  assert.deepEqual(lines(failures(text)), [6]);
});

// scripts/lib/comments/typescript-comments.ts: the header and doc-comment policy for TS, TSX, JS and MJS files.
import assert from "node:assert/strict";
import test from "node:test";
import { typescriptCommentFailures } from "../scripts/lib/comments/typescript-comments.ts";

const failures = (text: string, key = "a.ts") => typescriptCommentFailures(key, text);
const lines = (found: readonly string[]) => found.map((failure: string) => Number(failure.split(":")[1]));

test("a header followed by doc comments on exports passes", () => {
  assert.deepEqual(failures("// What this is for.\n\n/** Adds. */\nexport function add() { return 1; }\n"), []);
});

test("a file without a header comment fails", () => {
  assert.deepEqual(lines(failures("export const a = 1;\n")), [1]);
});

test("a shebang may precede the header", () => {
  assert.deepEqual(failures("#!/usr/bin/env node\n// Runs it.\nexport const a = 1;\n"), []);
  assert.equal(failures("#!/usr/bin/env node\nexport const a = 1;\n").length, 1);
});

test("a comment inside a function body fails", () => {
  assert.deepEqual(lines(failures("// h\nexport function f() {\n  // why\n  return 1;\n}\n")), [3]);
});

test("a trailing comment fails, including after an export", () => {
  assert.deepEqual(lines(failures("// h\nexport const a = 1; // note\n")), [2]);
});

test("a JSDoc above a non-exported function fails", () => {
  assert.deepEqual(lines(failures("// h\n/** Private. */\nfunction helper() { return 1; }\nexport const a = helper();\n")), [2]);
});

test("a doc comment may sit above export default, export lists and types", () => {
  const text = "// h\n/** Default. */\nexport default function main() { return 1; }\n/** Kinds. */\nexport type Kind = \"a\";\n/** Named. */\nexport { main as other };\n";
  assert.deepEqual(failures(text), []);
});

test("two doc comments on one declaration fail", () => {
  assert.deepEqual(lines(failures("// h\n/** One. */\n/** Two. */\nexport const a = 1;\n")), [2]);
});

test("a doc comment separated from its declaration by a blank line fails", () => {
  assert.deepEqual(lines(failures("// h\n/** Far. */\n\nexport const a = 1;\n")), [2]);
});

test("a run of line comments counts as one comment", () => {
  assert.deepEqual(failures("// First line.\n// Second line.\nexport const a = 1;\n"), []);
});

test("comment-like text in strings, templates and regular expressions is not a comment", () => {
  const text = "// h\nexport const a = \"// no\";\nexport const b = `/* no */ ${1} // no`;\nexport const c = /\\/\\/ no/;\nexport const d = 'it\\'s // no';\n";
  assert.deepEqual(failures(text), []);
});

test("commented-out code between statements fails", () => {
  assert.deepEqual(lines(failures("// h\nexport const a = 1;\n// export const b = 2;\n")), [3]);
});

test("a comment in JSX text is text but a comment in an expression container fails", () => {
  assert.deepEqual(failures("// h\nexport const a = <p>// hello</p>;\n", "a.tsx"), []);
  assert.deepEqual(lines(failures("// h\nexport const a = <p>{/* x */}</p>;\n", "a.tsx")), [2]);
});

test("a header-only empty module passes", () => {
  assert.deepEqual(failures("// Nothing yet.\n"), []);
});

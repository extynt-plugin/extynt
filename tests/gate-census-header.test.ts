// scripts/lib/census.ts: the header-length report across TypeScript, ExtendScript, C++ and shell sources.
import assert from "node:assert/strict";
import test from "node:test";
import { MAX_HEADER_LINES, headerLengthReport, headerLineCount } from "../scripts/lib/census.ts";

const run = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix} line ${index}`).join("\n");

test("a header counts the lines of its comment block in each language", () => {
  assert.equal(headerLineCount("a.ts", `${run("//", 3)}\nexport const x = 1;\n`), 3);
  assert.equal(headerLineCount("a.ts", `/**\n * one\n * two\n */\nexport const x = 1;\n`), 4);
  assert.equal(headerLineCount("a.jsx", `${run("//", 2)}\n/* global app */\n/* exported run */\nfunction run() {}\n`), 2);
  assert.equal(headerLineCount("a.cpp", `${run("//", 5)}\nint main();\n`), 5);
  assert.equal(headerLineCount("a.sh", `#!/usr/bin/env bash\n${run("#", 4)}\nset -euo pipefail\n`), 4);
  assert.equal(headerLineCount("a.ps1", `${run("#", 6)}\nSet-StrictMode -Version Latest\n`), 6);
});

test("a file without a header counts zero", () => {
  assert.equal(headerLineCount("a.ts", "export const x = 1;\n"), 0);
});

test("the report counts only headers over the cap, per area, largest area first", () => {
  const long = `${run("//", MAX_HEADER_LINES + 1)}\nexport const x = 1;\n`;
  const exact = `${run("//", MAX_HEADER_LINES)}\nexport const x = 1;\n`;
  const report = headerLengthReport([
    { key: "scripts/a.ts", text: long }, { key: "scripts/b.ts", text: exact },
    { key: "packages/decode/src/c.ts", text: long }, { key: "packages/decode/src/d.ts", text: long },
    { key: "native/extynt-core/core/e.cpp", text: `${run("//", 20)}\nint x;\n` },
  ]);
  assert.deepEqual(report.areas, [["packages/decode", 2], ["scripts", 1], ["native/core", 1]]);
  assert.equal(report.files.length, 4);
  assert.match(report.files[0] ?? "", /^scripts\/a\.ts: header is 13 lines/);
});

test("CRLF line endings give the same count", () => {
  const text = `${run("//", 7)}\nexport const x = 1;\n`;
  assert.equal(headerLineCount("a.ts", text.replaceAll("\n", "\r\n")), 7);
});

test("only a block that starts before the first token is a header", () => {
  assert.equal(headerLineCount("a.cpp", `int x;\n${run("//", 14)}\n`), 0);
  assert.equal(headerLineCount("a.sh", `echo hi\n${run("#", 14)}\n`), 0);
  assert.equal(headerLineCount("a.ps1", `Write-Host hi\n${run("#", 14)}\n`), 0);
});

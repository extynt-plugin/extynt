// The ExtendScript lint block in eslint.config.ts: ES5 parse, explicit host globals, banned ES5 library surface, $.evalFile placement.
import assert from "node:assert/strict";
import test from "node:test";
import { ESLint } from "eslint";

const eslint = new ESLint({ cwd: new URL("../", import.meta.url).pathname, flags: ["unstable_native_nodejs_ts_config"] });

async function rulesFor(code: string) {
  const results = await eslint.lintText(code, { filePath: "probe.jsx" });
  const result = results[0];
  if (result === undefined) throw new Error("eslint returned no result");
  return result.messages.map((message) => message.ruleId ?? "parse-error");
}

test("clean ExtendScript passes", async () => {
  assert.deepEqual(await rulesFor("var layer = app.project.activeItem;\nif (layer) { alert(String(layer.name)); }\n"), []);
});

test("ES5 parsing accepts reserved words as property names, ES6 syntax is a parse error", async () => {
  assert.deepEqual(await rulesFor("var row = {};\nrow.static = true;\nrow.enum = 1;\n"), []);
  assert.deepEqual(await rulesFor("let x = 1;\n"), ["parse-error"]);
  assert.deepEqual(await rulesFor("var f = function (a) { return a; };\nvar g = (a) => a;\n"), ["parse-error"]);
});

test("host globals are explicit: unknown names are undefined", async () => {
  assert.deepEqual(await rulesFor("var f = new File('a');\nvar c = CompItem;\nreadConfig(f, c);\n"), ["no-undef"]);
});

test("methods and statics ExtendScript lacks are banned", async () => {
  for (const code of ["var a = [];\na.forEach(alert);\n", "var a = Object.keys({});\nalert(a);\n", "alert(Array.isArray([]));\n", "alert(Date.now());\n", "alert(' a '.trim());\n"]) {
    assert.ok((await rulesFor(code)).some((rule) => rule === "no-restricted-syntax" || rule === "no-restricted-properties"), code);
  }
});

test("getters in object literals and trailing commas are rejected", async () => {
  assert.ok((await rulesFor("var o = { get a() { return 1; } };\nalert(o);\n")).includes("no-restricted-syntax"));
  assert.ok((await rulesFor("var o = { a: 1, };\nalert(o);\n")).includes("comma-dangle"));
});

test("$.evalFile is allowed at the top level and banned inside any function", async () => {
  assert.deepEqual(await rulesFor("$.evalFile(new File('a.jsx'));\n"), []);
  assert.deepEqual(await rulesFor("try { $.evalFile(new File('a.jsx')); } catch (error) { alert(error); }\n"), []);
  assert.deepEqual(await rulesFor("function load() { $.evalFile(new File('a.jsx')); }\nload();\n"), ["no-restricted-syntax"]);
  assert.deepEqual(await rulesFor("(function () { var f = $.evalFile; f(new File('a.jsx')); })();\n"), ["no-restricted-syntax"]);
});

test("structural hygiene rules are errors", async () => {
  assert.ok((await rulesFor("var a = 1;\nif (a == 1) { alert(a); }\n")).includes("eqeqeq"));
  assert.ok((await rulesFor("var a = 1;\nswitch (a) { case 1: alert(a); }\n")).includes("default-case"));
  assert.ok((await rulesFor("eval('1');\n")).includes("no-eval"));
  assert.ok((await rulesFor("function f() { var a = 1; function g(a) { return a; } return g(a); }\nf();\n")).includes("no-shadow"));
});

test("a /* global */ declaration makes a cross-file name defined", async () => {
  assert.deepEqual(await rulesFor("/* global aeApplyPlan */\naeApplyPlan();\n"), []);
});

// scripts/lib/path-filter.ts: the --paths option limits stages to matching repo-relative files.
import assert from "node:assert/strict";
import test from "node:test";
import { globToRegExp, pathGlobs, pathScope } from "../scripts/lib/path-filter.ts";

test("no globs keeps every file", () => {
  assert.equal(pathScope([])("anything/at/all.ts"), true);
});

test("double star crosses directories and single star stays in one", () => {
  const scope = pathScope(["apps/sidecar/src/**", "tests/gate-*"]);
  assert.equal(scope("apps/sidecar/src/deep/file.ts"), true);
  assert.equal(scope("apps/sidecar/tests/file.ts"), false);
  assert.equal(scope("tests/gate-x.test.mjs"), true);
  assert.equal(scope("tests/nested/gate-x.mjs"), false);
});

test("braces list alternatives and a bare directory matches its contents", () => {
  const scope = pathScope(["packages/{llm,workflow}/src/*.ts", "scripts"]);
  assert.equal(scope("packages/llm/src/a.ts"), true);
  assert.equal(scope("packages/host-ae/src/a.ts"), false);
  assert.equal(scope("scripts/lib/x.ts"), true);
});

test("the option splits on commas outside braces", () => {
  assert.deepEqual(pathGlobs(["--only", "metrics", "--paths", "a/{b,c}/*.ts,d/**"]), ["a/{b,c}/*.ts", "d/**"]);
  assert.deepEqual(pathGlobs(["--only", "metrics"]), []);
});

test("regular expression characters in a path are literal", () => {
  assert.equal(globToRegExp("a.b/c+d.ts").test("a.b/c+d.ts"), true);
  assert.equal(globToRegExp("a.b/c+d.ts").test("axb/c+d.ts"), false);
});

test("--paths accepts space-separated globs, repeated flags and comma lists together", () => {
  assert.deepEqual(pathGlobs(["--paths", "a/**", "b/**", "c,d", "--keep-going"]), ["a/**", "b/**", "c", "d"]);
  assert.deepEqual(pathGlobs(["--paths", "a", "--only", "x", "--paths", "b"]), ["a", "b"]);
});

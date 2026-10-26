// scripts/lib/sources.ts: the maintained set covers every language and excludes only the explicitly listed code.
import assert from "node:assert/strict";
import test from "node:test";
import { EXCLUDED_PREFIXES, GENERATED_FILES, isExcludedPath, maintainedFiles, nativeFiles, rel, shellFiles } from "../scripts/lib/sources.ts";

test("the maintained set includes ExtendScript, native and shell sources", () => {
  assert.ok(maintainedFiles().some((file) => rel(file).endsWith(".jsx")));
  assert.ok(nativeFiles().some((file) => rel(file).endsWith(".mm")));
  assert.ok(nativeFiles().some((file) => rel(file).endsWith(".cpp")));
  assert.ok(shellFiles().length > 0);
});

test("only vendored code and external-API stubs are excluded, each with a reason", () => {
  assert.deepEqual([...EXCLUDED_PREFIXES.keys()].sort(), ["native/extynt-core/tests/syntax-check/stubs/", "native/extynt-core/third_party/"]);
  for (const reason of EXCLUDED_PREFIXES.values()) assert.ok(reason.length > 10);
  assert.ok(isExcludedPath("native/extynt-core/third_party/xxhash/xxhash.h"));
  assert.ok(!isExcludedPath("native/extynt-core/core/walker.cpp"));
  assert.ok(!nativeFiles().some((file) => isExcludedPath(rel(file))));
});

test("the generated panel bundle and its manifest are the only generated files", () => {
  assert.deepEqual([...GENERATED_FILES], ["apps/panel/main.js", "apps/panel/ui-manifest.json"]);
  assert.ok(!maintainedFiles().some((file) => GENERATED_FILES.has(rel(file))));
});

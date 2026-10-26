// The gate reaches every language we keep: Objective-C .m, extensionless shell scripts and Inno Setup scripts get the same stages as their siblings.
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import { bannedTokenFailures } from "../scripts/lib/banned-tokens.ts";
import { headerLineCount } from "../scripts/lib/census.ts";
import { commentFailures } from "../scripts/lib/comment-rules.ts";
import { formatFailures } from "../scripts/lib/format-check.ts";
import { languageOf } from "../scripts/lib/language.ts";
import { nativeMetricFailures } from "../scripts/lib/native-metrics.ts";
import { ROOT, innoFiles, nativeFiles, rel, shellFiles } from "../scripts/lib/sources.ts";

const STYLE = "native/extynt-core/.clang-format";
const comments = (key: string, text: string) => commentFailures({ key, text }).map((failure) => Number(failure.split(":")[1]));

function fixture(t: TestContext, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "extynt-gate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "native/extynt-core"), { recursive: true });
  copyFileSync(join(ROOT, STYLE), join(root, STYLE));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  return root;
}

test("the source sets include .m, extensionless shell scripts and the Inno script", () => {
  assert.ok(nativeFiles().some((file) => rel(file).endsWith(".m")));
  assert.ok(shellFiles().some((file) => rel(file) === "plugin/bin/extynt-mcp"));
  assert.ok(shellFiles().some((file) => rel(file) === "packaging/macos/release/scripts/postinstall"));
  assert.ok(innoFiles().some((file) => rel(file) === "packaging/windows/extynt.iss"));
  assert.ok(!shellFiles().some((file) => rel(file) === "LICENSE"));
});

test("a file's language is its extension, or shell when an extensionless file starts with a shell shebang", () => {
  assert.equal(languageOf("a/b.c/Thing.m", ""), ".m");
  assert.equal(languageOf("bin/tool", "#!/bin/sh\n"), ".sh");
  assert.equal(languageOf("bin/tool", "#!/usr/bin/env bash\n"), ".sh");
  assert.equal(languageOf("bin/tool", "#!/usr/bin/env node\n"), "");
  assert.equal(languageOf("LICENSE", "MIT License\n"), "");
});

test("an Objective-C file keeps only its header comment, like .mm", () => {
  assert.deepEqual(comments("a.m", "// Draws it.\nint f(void) { return 1; }\n"), []);
  assert.deepEqual(comments("a.m", "int f(void) { return 1; }\n"), [1]);
  assert.deepEqual(comments("a.m", "// Draws it.\n\n/** doc */\nint f(void) {\n  // why\n  return 1;\n}\n"), [3, 5]);
  assert.equal(headerLineCount("a.m", `${Array.from({ length: 13 }, () => "//").join("\n")}\nint f(void);\n`), 13);
});

test("an extensionless shell script gets the shell comment rules", () => {
  assert.deepEqual(comments("bin/tool", "#!/bin/sh\nset -eu\n# Starts it.\nexec true\n"), []);
  assert.deepEqual(comments("bin/tool", "#!/bin/sh\nset -eu\nexec true\n"), [1]);
});

test("the C vararg ban reaches .m files", () => {
  assert.equal(bannedTokenFailures([{ key: "a.m", text: "void f(void) { fprintf(stderr, \"x\"); }\n" }]).length, 1);
  assert.deepEqual(bannedTokenFailures([{ key: "a.m", text: "void f(void) { NSLog(@\"x\"); }\n" }]), []);
});

test("lizard measures .m functions against the shared limits", (t) => {
  const body = Array.from({ length: 41 }, () => "  total += 1;").join("\n");
  const branches = Array.from({ length: 9 }, (_, index) => `  if (total == ${index}) total += 2;`).join("\n");
  const root = fixture(t, {
    "Long.m": `// Long.\nstatic int Long(int total) {\n${body}\n  return total;\n}\n`,
    "Branchy.m": `// Branchy.\nstatic int Branchy(int total) {\n${branches}\n  return total;\n}\n`,
    "Fine.m": "// Fine.\nstatic int Fine(int total) {\n  return total + 1;\n}\n",
  });
  const failures = nativeMetricFailures({ root, files: ["Long.m", "Branchy.m", "Fine.m"] });
  assert.equal(failures.length, 2);
  assert.match(failures[0] ?? "", /^Long\.m:\d+ Long has 44 NLOC > 40$/);
  assert.match(failures[1] ?? "", /^Branchy\.m:\d+ Branchy complexity 10 > 8$/);
});

test("clang-format checks .m files against the checked-in style", (t) => {
  const root = fixture(t, { "Bad.m": "// Bad.\nint f(int a){return a+1;}\n", "Good.m": "// Good.\nint f(int a) { return a + 1; }\n" });
  const failures = formatFailures({ root, files: ["Bad.m", "Good.m"] });
  assert.ok(failures.length > 0);
  assert.ok(failures.every((failure) => failure.startsWith("Bad.m:")));
});

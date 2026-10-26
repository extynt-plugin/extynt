// The build id covers every compiled module, nested ones included, so an edit to any of them changes the id.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleDigest } from "../src/server-build.js";

function withModules(files: Record<string, string>, run: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "sidecar-build-"));
  try {
    for (const [relative, text] of Object.entries(files)) {
      const target = join(directory, ...relative.split("/"));
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, text);
    }
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("an edit to a module in a subdirectory changes the digest", () => {
  withModules({ "top.js": "a", "host/focus-body.js": "b" }, (directory) => {
    const before = moduleDigest(directory);
    writeFileSync(join(directory, "host", "focus-body.js"), "b2");
    assert.notEqual(moduleDigest(directory), before);
  });
});

test("a moved module changes the digest even when its bytes do not", () => {
  withModules({ "host/a.js": "same" }, (directory) => {
    const before = moduleDigest(directory);
    renameSync(join(directory, "host", "a.js"), join(directory, "verify-a.js"));
    assert.notEqual(moduleDigest(directory), before);
  });
});

test("the digest depends only on the compiled modules, not on other files", () => {
  withModules({ "top.js": "a", "notes.txt": "one" }, (directory) => {
    const before = moduleDigest(directory);
    writeFileSync(join(directory, "notes.txt"), "two");
    assert.equal(moduleDigest(directory), before);
  });
});

test("an unreadable directory has no digest", () => {
  assert.equal(moduleDigest(join(tmpdir(), "sidecar-build-missing-directory-that-does-not-exist")), null);
});

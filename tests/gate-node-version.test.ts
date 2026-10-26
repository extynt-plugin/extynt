// scripts/lib/node-version.ts: the gate's Node floor is the shipped runtime's version, read from one file.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { RUNTIME_ENV, atLeast, minimumNodeVersion, nodeVersionProblem } from "../scripts/lib/node-version.ts";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");

test("versions compare numerically, not as strings", () => {
  assert.equal(atLeast("v24.21.0", "24.21.0"), true);
  assert.equal(atLeast("24.3.0", "24.21.0"), false);
  assert.equal(atLeast("25.0.0", "24.21.0"), true);
  assert.equal(atLeast("24.21.1", "24.21.0"), true);
  assert.equal(atLeast("23.99.99", "24.0.0"), false);
  assert.equal(atLeast("nonsense", "24.0.0"), false);
});

test("the minimum is the shipped runtime version", () => {
  const shipped = /^NODE_VERSION=(\S+)$/m.exec(readFileSync(join(ROOT, RUNTIME_ENV), "utf8"))?.[1];
  assert.equal(minimumNodeVersion(ROOT), shipped);
});

test("an older Node fails with a message naming the minimum and the running version", (t) => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "extynt-node-version-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "packaging", "macos"), { recursive: true });
  writeFileSync(join(root, RUNTIME_ENV), "# comment\nNODE_VERSION=24.21.0\nNODE_SHA256_DARWIN_ARM64=abc\n");
  assert.match(nodeVersionProblem("v24.3.0", root) ?? "", /Node 24\.21\.0 or newer.*this is v24\.3\.0/s);
  assert.equal(nodeVersionProblem("v24.21.0", root), undefined);
  assert.equal(nodeVersionProblem("v25.9.0", root), undefined);
});

test("a runtime file without a version is an error, not a pass", (t) => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "extynt-node-version-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "packaging", "macos"), { recursive: true });
  writeFileSync(join(root, RUNTIME_ENV), "NODE_SHA256_DARWIN_ARM64=abc\n");
  assert.throws(() => minimumNodeVersion(root), /no NODE_VERSION/);
});

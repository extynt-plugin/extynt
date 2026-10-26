/** Tests that every place holding the product version agrees with the root package.json. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repo_root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");

test("every place that holds the product version agrees with the root package.json", () => {
  const result = spawnSync(process.execPath, [path.join(repo_root, "scripts", "version-metadata.ts")], { encoding: "utf8" });
  assert.equal(result.stdout.trim(), "", "run: node scripts/bump-version.ts <version>");
  assert.equal(result.status, 0, result.stderr);
});

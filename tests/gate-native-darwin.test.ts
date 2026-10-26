// scripts/lib/native-darwin.ts: the macOS-only clang-tidy setup, and proof that other platforms are left untouched.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { DARWIN_IGNORED_HEADERS, darwinTidyConfig, darwinTidyConfigFile, tidyEnvironment } from "../scripts/lib/native-darwin.ts";

const SOURCE = join(dirname(new URL(import.meta.url).pathname), "..", "native", "extynt-core");
const CONFIG = readFileSync(join(SOURCE, ".clang-tidy"), "utf8");
const toolResult = (ok: boolean, output: string) => ({ ok, output, status: ok ? 0 : 1, error: undefined });
const IGNORE = /misc-include-cleaner\.IgnoreHeaders: '([^']*)'/;

test("the overlay extends only the include-cleaner ignore list and keeps the Linux entries", () => {
  const overlay = darwinTidyConfig(CONFIG);
  const linuxList = IGNORE.exec(CONFIG)?.[1] ?? "";
  const darwinList = IGNORE.exec(overlay)?.[1] ?? "";
  assert.equal(darwinList, [linuxList, ...DARWIN_IGNORED_HEADERS].join(";"));
  assert.equal(overlay.replace(IGNORE, ""), CONFIG.replace(IGNORE, ""));
  assert.ok(overlay.includes("WarningsAsErrors: '*'"));
});

test("every mapped header is a valid regex and none disables a check or names a project header", () => {
  for (const pattern of DARWIN_IGNORED_HEADERS) assert.doesNotThrow(() => new RegExp(pattern));
  assert.equal(DARWIN_IGNORED_HEADERS.some((pattern) => /extynt|core|transport/.test(pattern)), false);
});

test("a configuration without the ignore option is an error, not a silent no-op", () => {
  assert.throws(() => darwinTidyConfig("Checks: '*'\n"), /IgnoreHeaders/);
});

test("the overlay file is written on macOS only", (t) => {
  const out = mkdtempSync(join(realpathSync(tmpdir()), "extynt-darwin-config-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  assert.equal(darwinTidyConfigFile({ source: SOURCE, outDirectory: out, platform: "linux" }), undefined);
  assert.equal(existsSync(join(out, "clang-tidy-darwin.yaml")), false);
  const file = darwinTidyConfigFile({ source: SOURCE, outDirectory: out, platform: "darwin" });
  assert.equal(readFileSync(file ?? "", "utf8"), darwinTidyConfig(CONFIG));
});

test("SDKROOT comes from xcrun on macOS when unset, and an existing value wins", () => {
  const calls: string[][] = [];
  const run = (command: string, args: readonly string[]) => { calls.push([command, ...args]); return toolResult(true, "/SDK/MacOSX.sdk\n"); };
  assert.equal(tidyEnvironment({ env: { A: "1" }, platform: "darwin", run }).SDKROOT, "/SDK/MacOSX.sdk");
  assert.deepEqual(calls, [["xcrun", "--show-sdk-path"]]);
  assert.equal(tidyEnvironment({ env: { SDKROOT: "/mine" }, platform: "darwin", run }).SDKROOT, "/mine");
  assert.equal(calls.length, 1);
});

test("other platforms keep the environment object as it is", () => {
  const env = { A: "1" };
  const run = () => { throw new Error("xcrun must not run"); };
  assert.equal(tidyEnvironment({ env, platform: "linux", run }), env);
});

test("a failing xcrun is a clear error", () => {
  assert.throws(() => tidyEnvironment({ env: {}, platform: "darwin", run: () => toolResult(false, "") }), /xcrun --show-sdk-path/);
});

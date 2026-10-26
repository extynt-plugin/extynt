// scripts/install-host-library.ts: the host jsx files and a manifest the native plugin can trust.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { decodeOrThrow, jsonObject, object, string } from "../packages/decode/dist/src/index.js";
import { parseJson } from "../apps/sidecar/dist/tests/http-json.js";
import { defaultStateDirectory, installHostLibrary, removeCapitalisedStateDirectory, sanitiseVersion } from "../scripts/install-host-library.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "apps", "panel", "host");
const VERSION = /^[0-9A-Za-z._+-]{1,64}$/;

function temporary(t: TestContext) {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "extynt-install-library-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function fixtureSource(t: TestContext) {
  const source = join(temporary(t), "host");
  mkdirSync(source);
  writeFileSync(join(source, "probe.jsx"), "var a = 1;\n");
  writeFileSync(join(source, "part.jsx"), "var b = 2;\n");
  writeFileSync(join(source, "LICENSE.txt"), "not a script\n");
  return source;
}

const MANIFEST = object({ schema: string(), version: string(), entry: string() });
const manifestText = (directory: string) => parseJson(readFileSync(join(directory, "manifest.json"), "utf8"));
const manifestOf = (directory: string) => decodeOrThrow(MANIFEST, manifestText(directory));
const manifestKeys = (directory: string) => Object.keys(decodeOrThrow(jsonObject, manifestText(directory)));

test("the real host files are copied and the manifest names the schema, entry and version", (t) => {
  const destination = temporary(t);
  const result = installHostLibrary({ source: SOURCE, destination, packageVersion: "0.9.4a" });
  const manifest = manifestOf(result.directory);
  assert.deepEqual(manifestKeys(result.directory), ["schema", "version", "entry"]);
  assert.equal(manifest.schema, "extynt-host-library/1");
  assert.equal(manifest.entry, "probe.jsx");
  assert.match(manifest.version, VERSION);
  assert.match(manifest.version, /^0\.9\.4a\+[0-9a-f]{12}$/);
  assert.ok(readFileSync(join(result.directory, "manifest.json"), "utf8").endsWith("}\n"));
  const presets = existsSync(join(SOURCE, "puppet")) ? readdirSync(join(SOURCE, "puppet")).filter((name) => /^puppet-grid-[0-9a-z]+(-ae[0-9]+)?-1080\.ffx$/.test(name)).sort() : [];
  const copied = readdirSync(result.directory).filter((name) => name !== "manifest.json" && name !== "puppet").sort();
  assert.deepEqual(copied, readdirSync(SOURCE).filter((name) => name.endsWith(".jsx")).sort());
  assert.deepEqual(existsSync(join(result.directory, "puppet")) ? readdirSync(join(result.directory, "puppet")).sort() : [], presets);
  for (const name of presets) assert.ok(readFileSync(join(result.directory, "puppet", name)).equals(readFileSync(join(SOURCE, "puppet", name))));
  for (const name of copied) assert.equal(readFileSync(join(result.directory, name), "utf8"), readFileSync(join(SOURCE, name), "utf8"));
  assert.equal(existsSync(join(result.directory, "AEQUERY-LICENSE.txt")), false);
});

test("the same sources give the same manifest bytes, also in another destination", (t) => {
  const source = fixtureSource(t);
  const first = installHostLibrary({ source, destination: temporary(t), packageVersion: "1.2.3" });
  const bytes = readFileSync(join(first.directory, "manifest.json"), "utf8");
  installHostLibrary({ source, destination: dirname(first.directory), packageVersion: "1.2.3" });
  assert.equal(readFileSync(join(first.directory, "manifest.json"), "utf8"), bytes);
  const second = installHostLibrary({ source, destination: temporary(t), packageVersion: "1.2.3" });
  assert.equal(readFileSync(join(second.directory, "manifest.json"), "utf8"), bytes);
});

test("changing one source byte changes the version; the license text is never installed", (t) => {
  const source = fixtureSource(t);
  const destination = temporary(t);
  const before = installHostLibrary({ source, destination, packageVersion: "1.2.3" }).version;
  writeFileSync(join(source, "part.jsx"), "var b = 3;\n");
  const after = installHostLibrary({ source, destination, packageVersion: "1.2.3" }).version;
  assert.notEqual(after, before);
  assert.equal(readFileSync(join(destination, "host", "part.jsx"), "utf8"), "var b = 3;\n");
  assert.equal(existsSync(join(destination, "host", "LICENSE.txt")), false);
  writeFileSync(join(source, "LICENSE.txt"), "changed\n");
  assert.equal(installHostLibrary({ source, destination, packageVersion: "1.2.3" }).version, after, "non-jsx files do not count");
});

test("a .jsx file the source no longer has is removed, other files are left alone", (t) => {
  const source = fixtureSource(t);
  const destination = temporary(t);
  installHostLibrary({ source, destination, packageVersion: "1.2.3" });
  writeFileSync(join(destination, "host", "stale.jsx"), "old\n");
  writeFileSync(join(destination, "host", "notes.txt"), "keep\n");
  rmSync(join(source, "part.jsx"));
  const result = installHostLibrary({ source, destination, packageVersion: "1.2.3" });
  assert.deepEqual(readdirSync(result.directory).sort(), ["manifest.json", "notes.txt", "probe.jsx"]);
});

test("the version is sanitised and an unusable one throws", () => {
  assert.equal(sanitiseVersion("0.9.4a"), "0.9.4a");
  assert.equal(sanitiseVersion("1.0 beta/2"), "1.0-beta-2");
  assert.equal(sanitiseVersion("v".repeat(100)).length, 51);
  assert.throws(() => sanitiseVersion(""), /cannot form/);
  assert.equal(sanitiseVersion("///"), "---");
});

test("a source without probe.jsx is refused before anything is written", (t) => {
  const source = fixtureSource(t);
  rmSync(join(source, "probe.jsx"));
  const destination = temporary(t);
  assert.throws(() => installHostLibrary({ source, destination, packageVersion: "1.2.3" }), /no probe\.jsx/);
  assert.equal(existsSync(join(destination, "host")), false);
});

test("the default state directory follows the platform and $HOME", () => {
  assert.equal(defaultStateDirectory({ HOME: "/h" }, "darwin"), "/h/Library/Application Support/extynt");
  assert.equal(defaultStateDirectory({ HOME: "/h" }, "linux"), "/h/.config/extynt");
});

test("on Windows the state directory is %LOCALAPPDATA%\\extynt, falling back to AppData/Local under the home folder", () => {
  assert.equal(defaultStateDirectory({ HOME: "/h", LOCALAPPDATA: "/l" }, "win32"), "/l/extynt");
  assert.equal(defaultStateDirectory({ HOME: "/h" }, "win32"), "/h/AppData/Local/extynt");
});

test("the command installs under --dest and, without it, under $HOME and prints one line", (t) => {
  const home = temporary(t);
  const explicit = join(temporary(t), "state");
  const script = join(ROOT, "scripts", "install-host-library.ts");
  const run = (args: readonly string[]) => spawnSync(process.execPath, [script, ...args], { env: { ...process.env, HOME: home }, encoding: "utf8" });
  const first = run(["--dest", explicit]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout.trim().split("\n").length, 1);
  assert.match(first.stdout, new RegExp(`${explicit}/host.*version 0\\.\\S+\\+[0-9a-f]{12}`));
  assert.match(manifestOf(join(explicit, "host")).version, VERSION);
  const second = run([]);
  assert.equal(second.status, 0, second.stderr);
  assert.ok(second.stdout.includes(home));
  assert.equal(run(["--bogus"]).status, 1);
});

test("only a state directory whose on-disk name is capitalised is moved to the Trash, never the lowercase one", (t) => {
  const capitalised = join(temporary(t), "Extynt"), lowercase = join(temporary(t), "extynt");
  mkdirSync(capitalised);
  writeFileSync(join(capitalised, "chats.json"), "{}\n");
  mkdirSync(lowercase);
  writeFileSync(join(lowercase, "chats.json"), "{}\n");
  const trash = join(temporary(t), "Trash");
  mkdirSync(join(trash, "Extynt"), { recursive: true });
  assert.equal(removeCapitalisedStateDirectory(join(dirname(capitalised), "extynt"), trash), capitalised);
  assert.equal(readdirSync(dirname(capitalised)).includes("Extynt"), false);
  assert.equal(readFileSync(join(trash, readdirSync(trash).find((name) => name.startsWith("Extynt.")) ?? "", "chats.json"), "utf8"), "{}\n");
  assert.equal(readdirSync(trash).length, 2);
  assert.equal(removeCapitalisedStateDirectory(lowercase, trash), null);
  assert.equal(readFileSync(join(lowercase, "chats.json"), "utf8"), "{}\n");
  assert.equal(removeCapitalisedStateDirectory(join(dirname(lowercase), "missing", "extynt"), trash), null);
  assert.equal(removeCapitalisedStateDirectory(join(dirname(lowercase), "other"), trash), null);
});

test("the Puppet presets copied are the grid names with an optional -aeNN part, and nothing else in puppet/", (t) => {
  const source = fixtureSource(t);
  const names = ["puppet-grid-4x4-1080.ffx", "puppet-grid-12x12-1080.ffx", "puppet-grid-4x4-ae25-1080.ffx", "puppet-grid-12x12-ae25-1080.ffx"];
  const junk = ["puppet-grid-4x4-ae-1080.ffx", "puppet-grid-4x4-AE25-1080.ffx", "puppet-grid-4x4-ae25x-1080.ffx", "puppet-grid-4x4-ae25-1080.ffx.bak", "notes.txt"];
  mkdirSync(join(source, "puppet"));
  for (const name of [...names, ...junk]) writeFileSync(join(source, "puppet", name), "binary\n");
  const destination = temporary(t);
  const result = installHostLibrary({ source, destination, packageVersion: "1.2.3" });
  assert.deepEqual(readdirSync(join(result.directory, "puppet")).sort(), [...names].sort());
});

// Tests that the discovery file is read, validated and watched, with each failure told apart by its code.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, renameSync, rmSync, type watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { JsonValue } from "@extynt/decode";
import { defaultDiscoveryPath, readPluginEndpoint, stateDirectory, watchPluginEndpoint } from "../src/index.js";

function temporaryDirectory(): string {
  return mkdtempSync(join(tmpdir(), "extynt-discovery-"));
}

const alive: typeof process.kill = () => true;
const dead: typeof process.kill = () => { throw Object.assign(new Error("ESRCH"), { code: "ESRCH" }); };
const foreign: typeof process.kill = () => { throw Object.assign(new Error("EPERM"), { code: "EPERM" }); };

function writeEndpoint(directory: string, data: JsonValue): string {
  const path = join(directory, "native.json");
  writeFileSync(path, typeof data === "string" ? data : JSON.stringify(data));
  return path;
}

test("a valid file yields the endpoint with its optional members", () => {
  const directory = temporaryDirectory();
  const path = writeEndpoint(directory, { port: 49152, token: "abc", pid: 4242, aeVersion: "25.2", pluginVersion: "0.1.0" });
  const found = readPluginEndpoint(path, alive);
  assert.deepEqual(found.ok && found.endpoint, { path, port: 49152, token: "abc", pid: 4242, aeVersion: "25.2", pluginVersion: "0.1.0" });
  rmSync(directory, { recursive: true });
});

test("optional members that are absent or the wrong type read as null, and no pid skips the liveness check", () => {
  const directory = temporaryDirectory();
  const path = writeEndpoint(directory, { port: 7, token: "t", pid: "x", aeVersion: 5 });
  const found = readPluginEndpoint(path, dead);
  assert.deepEqual(found.ok && [found.endpoint.pid, found.endpoint.aeVersion, found.endpoint.pluginVersion], [null, null, null]);
  rmSync(directory, { recursive: true });
});

test("a missing file is DISCOVERY_MISSING", () => {
  const directory = temporaryDirectory();
  const found = readPluginEndpoint(join(directory, "native.json"), alive);
  assert.deepEqual(!found.ok && found.code, "DISCOVERY_MISSING");
  rmSync(directory, { recursive: true });
});

test("a file naming a dead pid is DISCOVERY_STALE, but a pid owned by another user is alive", () => {
  const directory = temporaryDirectory();
  const path = writeEndpoint(directory, { port: 7, token: "t", pid: 99999999 });
  const stale = readPluginEndpoint(path, dead);
  assert.deepEqual(!stale.ok && stale.code, "DISCOVERY_STALE");
  assert.match(!stale.ok ? stale.message : "", /99999999/);
  assert.equal(readPluginEndpoint(path, foreign).ok, true);
  rmSync(directory, { recursive: true });
});

test("half-written JSON, a missing token and a bad port are DISCOVERY_INVALID", () => {
  const directory = temporaryDirectory();
  const bodies: JsonValue[] = ['{"port": 12', { port: 7 }, { port: 7, token: "" }, { port: 0, token: "t" }, { port: 70000, token: "t" }, { port: 1.5, token: "t" }, [1, 2], "null"];
  for (const body of bodies) {
    const found = readPluginEndpoint(writeEndpoint(directory, body), alive);
    assert.deepEqual(!found.ok && found.code, "DISCOVERY_INVALID", JSON.stringify(body));
  }
  rmSync(directory, { recursive: true });
});

test("a path that cannot be read as a file is DISCOVERY_UNREADABLE", () => {
  const directory = temporaryDirectory();
  const path = join(directory, "native.json");
  mkdirSync(path);
  const found = readPluginEndpoint(path, alive);
  assert.deepEqual(!found.ok && found.code, "DISCOVERY_UNREADABLE");
  rmSync(directory, { recursive: true });
});

test("the default path is native.json in the per-user state directory", () => {
  assert.equal(defaultDiscoveryPath(), join(stateDirectory(), "native.json"));
  assert.match(stateDirectory(), /extynt$/);
});

async function nextChange(count: () => number, from: number): Promise<void> {
  const start = Date.now();
  while (count() <= from) {
    if (Date.now() - start > 3000) throw new Error("the watcher did not fire");
    await new Promise((resolve) => { setTimeout(resolve, 10); });
  }
}

test("the watcher fires when native.json is created, rewritten and replaced, and ignores other files", async () => {
  const directory = temporaryDirectory();
  let fired = 0;
  const watcher = watchPluginEndpoint(join(directory, "native.json"), () => { fired += 1; });
  try {
    writeEndpoint(directory, { port: 1, token: "a" });
    await nextChange(() => fired, 0);
    const afterCreate = fired;
    writeEndpoint(directory, { port: 2, token: "b" });
    await nextChange(() => fired, afterCreate);
    const afterRewrite = fired;
    writeFileSync(join(directory, "native.json.tmp"), "{}");
    renameSync(join(directory, "native.json.tmp"), join(directory, "native.json"));
    await nextChange(() => fired, afterRewrite);
    const afterReplace = fired;
    writeFileSync(join(directory, "session.json"), "{}");
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    assert.equal(fired, afterReplace);
  } finally {
    watcher.close();
    rmSync(directory, { recursive: true });
  }
});

test("the watcher creates a missing state directory and stops after close", async () => {
  const parent = temporaryDirectory();
  const directory = join(parent, "state");
  let fired = 0;
  const watcher = watchPluginEndpoint(join(directory, "native.json"), () => { fired += 1; });
  watcher.close();
  writeEndpoint(directory, { port: 1, token: "a" });
  await new Promise((resolve) => { setTimeout(resolve, 100); });
  assert.equal(fired, 0);
  rmSync(parent, { recursive: true });
});

test("a directory the system refuses to watch is polled instead, and the poll stops after close", async () => {
  const directory = temporaryDirectory();
  const refused: typeof watch = () => { throw Object.assign(new Error("EMFILE: too many open files, watch"), { code: "EMFILE" }); };
  let fired = 0;
  const watcher = watchPluginEndpoint(join(directory, "native.json"), () => { fired += 1; }, refused);
  try {
    writeEndpoint(directory, { port: 1, token: "a" });
    await nextChange(() => fired, 0);
  } finally {
    watcher.close();
  }
  const afterClose = fired;
  writeEndpoint(directory, { port: 2, token: "b" });
  await new Promise((resolve) => { setTimeout(resolve, 1_500); });
  assert.equal(fired, afterClose);
  rmSync(directory, { recursive: true });
});

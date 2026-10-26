/** Tests reading the native discovery file. */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { JsonValue } from "@extynt/decode";
import { assertFresh, pidAlive, readDiscovery } from "../lib/discovery.ts";
import type { Discovery, KillProcess } from "../lib/discovery.ts";
import { SpikeError } from "../lib/errors.ts";

function writeDiscovery(content: JsonValue): string {
  const path = join(mkdtempSync(join(tmpdir(), "spike-discovery-")), "native.json");
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

test("a missing discovery file names the path and the likely cause", () => {
  assert.throws(() => readDiscovery("/nonexistent/native.json"), (error) => (
    error instanceof SpikeError && error.code === "DISCOVERY_MISSING" && error.message.includes("/nonexistent/native.json") && /not running|not loaded/.test(error.message)
  ));
});

test("a valid discovery file is parsed, tolerating absent optional fields", () => {
  const path = writeDiscovery({ port: 4242, token: "abc", pid: 99, aeVersion: "26.0", pluginVersion: "0.1.0" });
  assert.deepEqual(readDiscovery(path), { port: 4242, token: "abc", pid: 99, aeVersion: "26.0", pluginVersion: "0.1.0" });
  assert.equal(readDiscovery(writeDiscovery({ port: 1, token: "t" })).pid, null);
});

test("malformed or incomplete discovery files are DISCOVERY_INVALID", () => {
  assert.throws(() => readDiscovery(writeDiscovery("{half")), { code: "DISCOVERY_INVALID" });
  assert.throws(() => readDiscovery(writeDiscovery({ port: 0, token: "t" })), { code: "DISCOVERY_INVALID" });
  assert.throws(() => readDiscovery(writeDiscovery({ port: 80 })), { code: "DISCOVERY_INVALID" });
});

function failingKill(code: string): KillProcess {
  return () => { throw Object.assign(new Error("x"), { code }); };
}

test("pidAlive treats ESRCH as dead and EPERM as alive", () => {
  assert.equal(pidAlive(process.pid), true);
  assert.equal(pidAlive(1, failingKill("ESRCH")), false);
  assert.equal(pidAlive(1, failingKill("EPERM")), true);
});

test("a dead pid is a DISCOVERY_STALE error unless the check is skipped", () => {
  const dead = failingKill("ESRCH");
  const discovery: Discovery = { port: 1, token: "t", pid: 4321, aeVersion: null, pluginVersion: null };
  assert.throws(() => assertFresh(discovery, "/p/native.json", { kill: dead }), (error) => error instanceof SpikeError && error.code === "DISCOVERY_STALE" && /4321/.test(error.message));
  assertFresh(discovery, "/p/native.json", { kill: dead, skipPidCheck: true });
  assertFresh({ ...discovery, pid: null }, "/p/native.json", { kill: dead });
});

// Tests that host identity is derived from a version string like the plugin does and decodes from the plugin's own report.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { array, boolean, decode, decodeJson, decodeOrThrow, nullable, number, object, string } from "@extynt/decode";
import type { JsonObject } from "@extynt/decode";
import { deriveHostIdentity, describeHost, hostBriefingNote, hostIdentityOf, hostRefusal, pingDirectResult, pluginHostIdentity } from "../src/index.js";

const vectorsFile = object({
  cases: array(object({
    experimental: boolean(), input: string(), known: boolean(), major: nullable(number()), minor: nullable(number()), patch: nullable(number()),
    build: nullable(string()), family: string(), svgImport: string(), supported: boolean(), measured: boolean(),
  })),
});

function repoRoot(from: string): string {
  for (let directory = from; ; directory = dirname(directory)) {
    if (existsSync(join(directory, "pnpm-workspace.yaml"))) return directory;
    if (dirname(directory) === directory) throw new Error("repository root not found");
  }
}

const vectorsPath = join(repoRoot(dirname(fileURLToPath(import.meta.url))), "native/extynt-core/tests/vectors/host_versions.json");
const cases = decodeJson(readFileSync(vectorsPath, "utf8"), vectorsFile);

test("the derived identity matches the shared vectors the C++ plugin is held to", () => {
  assert.ok(cases.ok && cases.value.cases.length >= 8);
  for (const vector of cases.ok ? cases.value.cases : []) {
    const host = deriveHostIdentity(vector.input);
    const label = JSON.stringify(vector.input);
    assert.equal(host.family, vector.family, label);
    assert.equal(host.capabilities.svgImport, vector.svgImport, label);
    assert.equal(host.supported, vector.supported, label);
    assert.equal(host.measured, vector.measured, label);
    assert.equal(host.experimental, vector.experimental, label);
    assert.deepEqual([host.major, host.minor, host.patch], vector.known ? [vector.major, vector.minor, vector.patch] : [null, null, null], label);
    assert.equal(host.build, vector.build, label);
  }
});

test("a derived identity says what it cannot know instead of guessing", () => {
  const host = deriveHostIdentity("25.6.0 (build 41)");
  assert.equal(host.source, "derived");
  assert.equal(host.capabilities.expressionText, "unknown");
  assert.equal(host.capabilities.suitesComplete, null);
  assert.equal(host.aegpApi, null);
  assert.equal(deriveHostIdentity("26.5.x").family, "unknown");
});

const CAPABILITIES: JsonObject = { svgImport: "converter", expressionText: "utf16", suitesComplete: true, streamSuite: 10, revisionGuard: "on" };
const REPORTED: JsonObject = { version: "25.6.0 (build 41)", major: 25, minor: 6, patch: 0, build: "41", family: "ae25", supported: true, measured: false, experimental: false, aegpApi: "1.9", capabilities: CAPABILITIES };

test("the plugin's own host object is parsed whole and is preferred to a derived one", () => {
  const host = decodeOrThrow(pluginHostIdentity, REPORTED);
  assert.equal(host.source, "plugin");
  assert.equal(host.capabilities.expressionText, "utf16");
  assert.equal(hostIdentityOf(host, "26.5.0")?.family, "ae25");
  assert.equal(hostIdentityOf(null, "26.5.0")?.family, "ae26");
  assert.equal(hostIdentityOf(null, null), null);
});

function withCapability(key: string, value: string): JsonObject {
  return { ...REPORTED, capabilities: { ...CAPABILITIES, [key]: value } };
}

test("a malformed host object is dropped, never half-read", () => {
  const broken = [null, "x", { ...REPORTED, family: "ae99" }, withCapability("svgImport", "maybe"), { ...REPORTED, supported: "yes" }, { ...REPORTED, experimental: "no" }, withCapability("revisionGuard", "maybe"), { ...REPORTED, major: "25" }];
  for (const candidate of broken) assert.equal(decode(pluginHostIdentity, candidate).ok, false);
});

test("ping_direct keeps a missing host as null so an older plugin still pairs", () => {
  const base: JsonObject = { pong: true, mainThread: false, pluginVersion: "0.1.0", aeVersion: "26.5.0 (build 61)", pid: 1, arch: "arm64", idleAgeMs: null, idleTicks: 0, queueDepth: 0, oldestQueuedMs: null, watchers: 0, library: { version: null, entryFile: null } };
  assert.equal(decodeOrThrow(pingDirectResult, base).host, null);
  assert.equal(decodeOrThrow(pingDirectResult, { ...base, host: REPORTED }).host?.family, "ae25");
});

test("describeHost names the family and whether it is measured", () => {
  assert.equal(describeHost(decodeOrThrow(pluginHostIdentity, REPORTED)), "After Effects 25.6.0 (build 41), ae25, unmeasured");
  assert.equal(describeHost(deriveHostIdentity("26.5.0 (build 61)")), "After Effects 26.5.0 (build 61), ae26");
  assert.equal(describeHost(deriveHostIdentity("24.0")), "After Effects 24.0, older, below the supported floor, unmeasured");
  assert.equal(describeHost(null), "After Effects (version unknown)");
});

test("only a release newer than the measured one is experimental, and the one line says so", () => {
  assert.equal(deriveHostIdentity("27.1.0 (build 3)").experimental, true);
  assert.equal(deriveHostIdentity("26.5.0").experimental, false);
  assert.equal(deriveHostIdentity("25.6.0").experimental, false);
  assert.equal(deriveHostIdentity("").experimental, false);
  assert.match(describeHost(deriveHostIdentity("27.1.0")), /EXPERIMENTAL/);
  assert.doesNotMatch(describeHost(deriveHostIdentity("26.5.0")), /EXPERIMENTAL|unmeasured/);
});

test("a derived identity reports the revision guard on, and the plugin's own `off` is parsed", () => {
  assert.equal(deriveHostIdentity("25.6.0").capabilities.revisionGuard, "on");
  const off = decodeOrThrow(pluginHostIdentity, withCapability("revisionGuard", "off"));
  assert.equal(off.capabilities.revisionGuard, "off");
});

test("a host below 25 is refused in words that name its version and the floor; every other host is not", () => {
  assert.match(String(hostRefusal(deriveHostIdentity("24.6.0"))), /needs After Effects 25 or later; this is After Effects 24\.6\.0/);
  for (const text of ["25.0", "26.5.0 (build 61)", "27.1", "unknown"]) assert.equal(hostRefusal(deriveHostIdentity(text)), null, text);
  assert.equal(hostRefusal(null), null);
  assert.match(String(hostBriefingNote(deriveHostIdentity("24.6.0"))), /older than the oldest release extynt supports \(25\)\. Make no changes/);
});

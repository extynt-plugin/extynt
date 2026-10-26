/**
 * Golden tests for the native snapshot adapter: a native fixture goes through `toProbeEnvelope` and `normalizeProbeSnapshot`, and the result must equal
 * the normalisation of the probe envelope of the same project, except for the fields listed in DOCUMENTED_DIFFERENCES.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { decode, decodeOrThrow, fail, jsonValue, object, type Decoder, type JsonValue } from "@extynt/decode";
import { jsonFieldsOf, jsonOf } from "@extynt/mcp-server";
import type { ProjectSnapshot } from "@extynt/project-graph";
import { hostPlatformOf } from "../src/native-snapshot/envelope.js";
import { DOCUMENTED_DIFFERENCES, toProbeEnvelope, type NativeReadSet } from "../src/native-snapshot/index.js";
import { probeSnapshot } from "../src/server-probe-wire.js";
import { normalizeProbeSnapshot } from "../src/server-normalize.js";
import { mergeRead } from "../src/snapshot-merge.js";
import type { ProbeSnapshot, StoredSnapshot } from "../src/server-types.js";
import type { Opaque } from "../src/snapshot-view.js";
import { entry, isRow, makeLayer, makeResult, readSetOf, STAMP, type Row } from "./native-fixtures.js";

const resultOf = (snapshot: ProbeSnapshot): Row => jsonFieldsOf(snapshot.result);
const listOf = (value: Opaque): Row[] => (Array.isArray(value) ? value.filter(isRow) : []);

type Fixture = (...args: JsonValue[]) => JsonValue;
const fixture: Decoder<Fixture> = { run: (input) => (typeof input === "function" ? (...args) => decodeOrThrow(jsonValue, Reflect.apply(input, undefined, args)) : fail("a function", input)) };
const spikeFixtures = object({ makeResult: fixture, makeLayer: fixture, entry: fixture, probeEnvelope: fixture });

const RUNTIME = { application: "After Effects" as const, appVersion: "26.2.1", buildNumber: "2", buildName: null, platform: "macOS" as const, architecture: "arm64" as const, compatible: true };

function probeEnvelopeOf(layers: Row[]): ProbeSnapshot {
  const native = makeResult({ layers });
  const result = {
    runtime: RUNTIME, project: { name: "Test.aep", filePath: "/tmp/Test.aep" }, hostStamp: { epoch: 3, revision: 42 }, itemCount: 3,
    readScope: { compositions: "all", items: "read" }, revision: "3:5", activeCompositionId: "5", currentTime: 0, selectedLayerIds: [],
    items: native.items ?? [], sources: native.sources ?? [], compositions: native.compositions.map((composition) => jsonOf(composition)),
    compositionPages: { unread: [], partial: [], capped: false }, truncation: { truncated: false, limits: {} },
  };
  return { schemaVersion: "0.1", ok: true, requestId: "probe-1", result, warnings: [] };
}

function masked(snapshot: ProjectSnapshot): Row {
  const copy: Row = { ...jsonFieldsOf(snapshot) };
  for (const field of ["revision", "freshness", "hostStamp", "capturedAt"]) delete copy[field];
  return copy;
}

test("the TypeScript fixture is the project tools/native-spike/tests/fixtures.ts builds", async () => {
  const module = decodeOrThrow(spikeFixtures, await import(pathToFileURL(new URL("../../../../tools/native-spike/tests/fixtures.ts", import.meta.url).pathname).href));
  assert.deepEqual(module.makeResult(), jsonOf(makeResult()));
  assert.deepEqual(module.makeLayer("11", 1), jsonOf(makeLayer("11", 1)));
  assert.deepEqual(module.entry("A/B", { value: 3 }), entry("A/B", { value: 3 }));
  const envelope = module.probeEnvelope(module.makeResult());
  assert.ok(isRow(envelope) && envelope.ok === true && isRow(envelope.result) && envelope.result.source === "native");
});

test("a full native read normalises to what the probe read of the same project normalises to", () => {
  const read = readSetOf();
  const native = normalizeProbeSnapshot(toProbeEnvelope(read, null), "2026-10-04T10:00:00.000Z");
  const probe = normalizeProbeSnapshot(probeEnvelopeOf(makeResult().compositions.flatMap((composition) => (Array.isArray(composition.layers) ? composition.layers.filter(isRow) : []))), "2026-10-04T10:00:00.000Z");
  assert.deepEqual(masked(native), masked(probe));
  assert.equal(native.fingerprint, probe.fingerprint, "with the same host runtime the graph fingerprint is the same");
  assert.equal(native.selectionFingerprint, probe.selectionFingerprint);
  assert.equal(native.revision, "42", "the revision is the native stamp's");
  assert.deepEqual(native.hostStamp, { epoch: 3, revision: 42 });
});

test("text documents and key digests come from the details call and normalise like the probe's", () => {
  const document = { text: "Hello", font: "Arial-BoldMT", fontSize: 72, boxText: false, pointText: true };
  const layers = [makeLayer("11", 1, { propertyPaths: [
    entry("ADBE Text Properties/ADBE Text Document", { matchName: "ADBE Text Document", valueType: "unknown", value: document, canSetValue: true }),
    entry("ADBE Transform Group/ADBE Position", { valueType: "vector", value: [960, 540], keyframeCount: 3, keyDigest: "3:3:cafe" }),
    entry("ADBE Transform Group/ADBE Opacity", { value: 100, keyframeCount: 40, keyDigest: "40:20:beef", keyDigestTruncated: true }),
  ] })];
  const read = readSetOf({ layers });
  const properties = layerRows(read);
  assert.deepEqual(properties[0]?.value, { unsupported: "text-document" }, "the fixture really is what the plugin reports");
  const envelope = toProbeEnvelope(read, null);
  const adapted = normalizeProbeSnapshot(envelope), probe = normalizeProbeSnapshot(probeEnvelopeOf(layers));
  assert.deepEqual(masked(adapted), masked(probe));
  const row = (path: string) => propertyRows(envelope).find((candidate) => candidate.path === path);
  assert.deepEqual(row("ADBE Text Properties/ADBE Text Document")?.value, document);
  assert.equal(row("ADBE Transform Group/ADBE Position")?.keyDigest, "3:3:cafe");
  assert.equal(row("ADBE Transform Group/ADBE Opacity")?.keyDigestTruncated, true);
});

function layerRows(read: NativeReadSet): Row[] {
  return listOf(listOf(listOf(jsonOf(read.project?.compositions))[0]?.layers)[0]?.propertyPaths);
}

function propertyRows(envelope: ProbeSnapshot): Row[] {
  return listOf(listOf(listOf(envelope.result.compositions)[0]?.layers)[0]?.propertyPaths);
}

test("without the details call a text document is null and a keyed property has no digest, and nothing else differs", () => {
  const layers = [makeLayer("11", 1, { propertyPaths: [
    entry("ADBE Text Properties/ADBE Text Document", { matchName: "ADBE Text Document", valueType: "unknown", value: { text: "Hello" } }),
    entry("ADBE Transform Group/ADBE Position", { valueType: "vector", value: [960, 540], keyframeCount: 3, keyDigest: "3:3:cafe" }),
  ] })];
  const read = readSetOf({ layers });
  delete read.details;
  const rows = propertyRows(toProbeEnvelope(read, null));
  assert.equal(rows[0]?.value, null);
  assert.equal("keyDigest" in (rows[1] ?? {}), false);
  assert.equal(rows[1]?.keyframeCount, 3);
});

test("values the plugin does not read become null, never a rendering of a host object", () => {
  const unsupported = (name: string) => ({ unsupported: name });
  const layers = [makeLayer("11", 1, { propertyPaths: ["marker", "mask-id", "shape-path", "arbitrary", "layer-id"].map((name) => entry(`P/${name}`, { value: unsupported(name) })) })];
  const read = readSetOf({ layers });
  delete read.details;
  const rows = propertyRows(toProbeEnvelope(read, null));
  assert.equal(rows.length, 5);
  assert.ok(rows.every((row) => row.value === null));
});

test("the plugin's hash and flag members never reach the envelope", () => {
  const layers = [makeLayer("11", 1, { hash: "a".repeat(32), propertyPaths: [entry("A/B", { hash: "b".repeat(32), dynFlags: 7 })] })];
  const read = readSetOf({ layers });
  if (read.project) Object.assign(read.project.compositions[0] ?? {}, { hash: "c".repeat(32) });
  const text = JSON.stringify(toProbeEnvelope(read, null));
  assert.equal(/"hash"|dynFlags/.test(text), false);
});

test("the envelope is accepted by the snapshot gate and carries the host identity from ping", () => {
  const envelope = toProbeEnvelope(readSetOf(), null);
  assert.equal(decode(probeSnapshot, jsonOf(envelope)).ok, true);
  assert.deepEqual(envelope.result.runtime, RUNTIME);
  assert.equal(envelope.requestId, "read-1");
  const odd = readSetOf();
  odd.ping = { ...odd.ping, aeVersion: "25.0", arch: "riscv" };
  const runtime = toProbeEnvelope(odd, null).result.runtime;
  assert.deepEqual([runtime.appVersion, runtime.buildNumber, runtime.architecture], ["25.0", null, "unknown"]);
});

test("the envelope names the sidecar's own OS as the host platform, so Windows evidence never pools under a Mac host key", () => {
  assert.equal(toProbeEnvelope(readSetOf(), null, "win32").result.runtime.platform, "Windows");
  assert.equal(toProbeEnvelope(readSetOf(), null, "darwin").result.runtime.platform, "macOS");
  assert.equal(hostPlatformOf("win32"), "Windows");
  assert.equal(hostPlatformOf("linux"), "macOS");
});

test("a read with no revision has no stamp and the normaliser falls back to the request id", () => {
  const read = readSetOf({ stamp: { revision: null } });
  const envelope = toProbeEnvelope(read, null);
  assert.equal("hostStamp" in envelope.result, false);
  assert.equal(normalizeProbeSnapshot(envelope).revision, "read-1");
});

test("an interrupted apply rides on the envelope exactly as the probe reported it", () => {
  const breadcrumb = { planId: "p-1", index: 3, operationCount: 9, operation: "set_layer_property", layerId: "12", startedAt: "1700000000" };
  const envelope = toProbeEnvelope(readSetOf(), breadcrumb);
  assert.deepEqual(envelope.result.interruptedApply, breadcrumb);
  assert.equal(toProbeEnvelope(readSetOf(), null).result.interruptedApply, undefined);
});

function scoped(requestId: string, over: { layerName?: string; includeItems?: boolean; revision?: number } = {}): ProbeSnapshot {
  const layers = [makeLayer("11", 1, { name: over.layerName ?? "Layer 11" }), makeLayer("12", 2)];
  const read = readSetOf({ layers, requestId, scope: { kind: "compositions", ids: ["5"], includeItems: over.includeItems === true }, stamp: { revision: over.revision ?? 43 } });
  return toProbeEnvelope(read, null);
}

test("a scoped native read is a scoped read to the existing merge, and merges onto a full read unchanged", () => {
  const full = toProbeEnvelope(readSetOf(), null);
  const base: StoredSnapshot = { snapshot: full, receivedAt: "2026-10-04T10:00:00.000Z", bytes: 1 };
  const read = scoped("read-2", { layerName: "Renamed" });
  assert.deepEqual([resultOf(read).readScope, resultOf(read).itemCount], [{ compositions: "listed", items: "skipped" }, 3]);
  const merged = mergeRead(base, read, ["5"]);
  assert.ok(merged.ok);
  if (!merged.ok) return;
  assert.equal(listOf(listOf(resultOf(merged.snapshot).compositions)[0]?.layers)[0]?.name, "Renamed");
  assert.deepEqual(resultOf(merged.snapshot).items, resultOf(full).items, "the item list the scoped read skipped is kept");
  assert.deepEqual(merged.observed.compositions, { "5": 43 });
  const withItems = resultOf(scoped("read-3", { includeItems: true }));
  assert.deepEqual([withItems.readScope, listOf(withItems.items).length], [{ compositions: "listed", items: "read" }, 3]);
});

test("a scoped read made across an epoch change is refused for a full one, like any other", () => {
  const base: StoredSnapshot = { snapshot: toProbeEnvelope(readSetOf(), null), receivedAt: "2026-10-04T10:00:00.000Z", bytes: 1 };
  const other = toProbeEnvelope(readSetOf({ layers: [makeLayer("11", 1)], scope: { kind: "compositions", ids: ["5"], includeItems: false }, stamp: { epoch: STAMP.epoch + 1 } }), null);
  const refused = mergeRead(base, other, ["5"]);
  assert.deepEqual(refused.ok ? null : refused.reason, "other-epoch");
});

test("every documented difference names a field, both values and a reason", () => {
  assert.ok(DOCUMENTED_DIFFERENCES.length >= 10);
  for (const difference of DOCUMENTED_DIFFERENCES) assert.ok(difference.field && difference.native && difference.probe && difference.reason.length > 20, difference.field);
});

test("a read from an After Effects below 25 is refused by the snapshot gate (D9); 25 and newer pass", () => {
  const read = (aeVersion: string) => { const set = readSetOf(); set.ping = { ...set.ping, aeVersion, host: null }; return toProbeEnvelope(set, null); };
  assert.equal(read("24.6.0 (build 3)").result.runtime.compatible, false);
  assert.equal(decode(probeSnapshot, jsonOf(read("24.6.0 (build 3)"))).ok, false);
  for (const version of ["25.0", "26.5.0 (build 61)", "27.1"]) assert.equal(decode(probeSnapshot, jsonOf(read(version))).ok, true, version);
});

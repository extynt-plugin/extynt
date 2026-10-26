/** Tests the detail requests a comparison makes for text and keyed properties. */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { JsonObject } from "@extynt/decode";
import { main } from "../lib/cli.ts";
import { compareSnapshots } from "../lib/compare.ts";
import { detailsRequest, mergeDetails, parseDetails } from "../lib/compare-details.ts";
import type { DetailsAnswer } from "../lib/compare-details.ts";
import { formatCompare } from "../lib/compare-report.ts";
import { textAt } from "../lib/json-access.ts";
import { entry, makeResult, probeEnvelope } from "./fixtures.ts";
import { errorResponse, okResponse, startFakeServer } from "./fake-server.ts";
import type { FakeHandler, FakeRequest } from "./fake-server.ts";
import { compositionOf, draftLayer, draftObjectOf, layerOf, listIn, parseObject, present, propertyOf } from "./snapshot-draft.ts";
import type { SnapshotPair } from "./snapshot-draft.ts";

const TEXT = "ADBE Text Properties/ADBE Text Document";
const POSITION = "ADBE Transform Group/ADBE Position";
const DOCUMENT = { text: "Hello", font: "Arial-BoldMT", fontSize: 72 };
const TIMING = { queuedMs: 1, walkMs: 2, hashMs: 3, serializeMs: 4, totalMainThreadMs: 5, bytes: 600, getterCalls: 7 };
const DEFAULT_LAYERS: ReadonlyArray<JsonObject> = [
  { compId: "5", layerId: "11", properties: [{ path: TEXT, value: DOCUMENT }, { path: POSITION, keyDigest: "3:3:cafe", keyframeCount: 3 }] },
];

function pair(): SnapshotPair {
  const probeLayer = draftObjectOf({
    ...draftLayer("11", 1),
    propertyPaths: [
      entry(TEXT, { matchName: "ADBE Text Document", valueType: "unknown", value: DOCUMENT }),
      entry(POSITION, { valueType: "vector", value: [960, 540], keyframeCount: 3, keyDigest: "3:3:cafe" }),
    ],
  });
  const nativeLayer = draftObjectOf(probeLayer);
  propertyOf(nativeLayer, TEXT).value = { unsupported: "text-document" };
  delete propertyOf(nativeLayer, POSITION).keyDigest;
  const probe = draftObjectOf(makeResult()), native = draftObjectOf(makeResult());
  compositionOf(probe).layers = [probeLayer];
  compositionOf(native).layers = [nativeLayer];
  return { probe, native };
}

function answer(layers: ReadonlyArray<JsonObject> = DEFAULT_LAYERS): DetailsAnswer {
  return { ok: true, layers };
}

test("the request names the layers with a text document or a keyed property and nothing else", () => {
  const { native } = pair();
  listIn(compositionOf(native), "layers").push(draftLayer("12", 2));
  assert.deepEqual(detailsRequest(native), { scopes: [{ compId: "5", layerIds: ["11"] }], include: ["textDocument", "keyDigest"], maxLayers: 256 });
  assert.equal(detailsRequest(makeResult()), null);
});

test("without the details call a text document is skipped and a key digest is not compared", () => {
  const { probe, native } = pair();
  const report = compareSnapshots(native, probe);
  assert.equal(report.verdict.pass, true);
  assert.equal(report.skipped["text-document"], 1);
  assert.equal(report.details, null);
});

test("with the details call the text document and the key digest are compared with the probe's", () => {
  const { probe, native } = pair();
  const same = compareSnapshots(native, probe, { details: answer() });
  const stats = present(same.details);
  assert.equal(same.verdict.pass, true);
  assert.equal(same.skipped["text-document"], undefined);
  assert.deepEqual([stats.layers, stats.textDocuments, stats.keyDigests, stats.unmatched], [1, 1, 1, 0]);
  assert.match(formatCompare(same), /details \(aeReadPropertyDetails\): 1 layers, 1 text documents and 1 key digests compared/);
  const wrongLayers = [{ compId: "5", layerId: "11", properties: [{ path: TEXT, value: { ...DOCUMENT, text: "Bye" } }, { path: POSITION, keyDigest: "3:3:dead" }] }];
  const wrong = compareSnapshots(native, probe, { details: answer(wrongLayers) });
  assert.equal(wrong.verdict.pass, false);
  assert.deepEqual(Object.keys(wrong.diffs).sort(), ["property.keyDigest", "property.value"]);
});

test("a failed details call merges nothing and says so; unmatched entries are counted", () => {
  const { probe, native } = pair();
  const failed = compareSnapshots(native, probe, { details: parseDetails('{"ok":false,"error":{"message":"library not found"}}') });
  assert.equal(failed.verdict.pass, true, "nothing was merged, so the unsupported value is skipped as before");
  assert.match(formatCompare(failed), /failed, nothing merged \(library not found\)/);
  const unmatchedLayers = [{ compId: "5", layerId: "99", properties: [] }, { compId: "5", layerId: "11", properties: [{ path: "No/Such", keyDigest: "x" }] }];
  const merged = mergeDetails(native, answer(unmatchedLayers));
  assert.equal(merged.stats.unmatched, 2);
  assert.deepEqual(propertyOf(layerOf(native, 0), TEXT).value, { unsupported: "text-document" }, "the native result is not modified");
});

test("parseDetails refuses anything that is not a details answer", () => {
  for (const text of ["", "not json", "[]", '{"ok":1}', '{"ok":true}']) assert.equal(parseDetails(text).ok, false, text);
  assert.equal(parseDetails(JSON.stringify(answer())).ok, true);
});

function detailsReply(request: FakeRequest, detailsText: string | null): JsonObject {
  if (detailsText === null) return errorResponse(request, "LIBRARY_NOT_FOUND", "no manifest");
  const reply = { source: "native", entry: request.entry ?? null, result: detailsText, scriptUs: 1, libraryLoaded: false, libraryLoadUs: 0, libraryVersion: "v", projectEpoch: 1 };
  return okResponse(request, reply, TIMING);
}

async function setup(native: JsonObject, detailsText: string | null) {
  const handler: FakeHandler = (request) => {
    if (request.op === "read_project") return okResponse(request, native, TIMING);
    if (request.op === "host_call") return detailsReply(request, detailsText);
    return okResponse(request, {}, TIMING);
  };
  const server = await startFakeServer(handler);
  const dir = mkdtempSync(join(tmpdir(), "spike-details-"));
  const discovery = join(dir, "native.json");
  writeFileSync(discovery, JSON.stringify({ port: server.port, token: "tok", pid: process.pid, aeVersion: "26.0", pluginVersion: "0.1.0" }));
  return { server, dir, discovery };
}

function capture() {
  const out: string[] = [], err: string[] = [];
  return { out, err, io: { stdout: { write: (text: string) => out.push(text) }, stderr: { write: (text: string) => err.push(text) }, env: {} } };
}

test("compare --details sends the request as a JSON string to host_call and folds the answer in", async () => {
  const { probe, native } = pair();
  const { server, dir, discovery } = await setup(native, JSON.stringify(answer()));
  const probeFile = join(dir, "probe.json");
  writeFileSync(probeFile, JSON.stringify(probeEnvelope(probe)));
  const run = capture();
  assert.equal(await main(["compare", "--probe", probeFile, "--details", "--discovery", discovery], run.io), 0);
  const plain = capture();
  assert.equal(await main(["compare", "--probe", probeFile, "--discovery", discovery], plain.io), 0);
  await server.close();
  const call = present(server.requests.find((request) => request.op === "host_call"));
  assert.equal(call.entry, "aeReadPropertyDetails");
  assert.deepEqual(parseObject(textAt(call, "args") ?? ""), { scopes: [{ compId: "5", layerIds: ["11"] }], include: ["textDocument", "keyDigest"], maxLayers: 256 });
  assert.match(run.out.join(""), /1 text documents and 1 key digests compared/);
  assert.equal(server.requests.filter((request) => request.op === "host_call").length, 1, "without --details no host_call is made");
  assert.doesNotMatch(plain.out.join(""), /details \(aeReadPropertyDetails\)/);
});

test("compare --details survives a plugin that refuses the call", async () => {
  const { probe, native } = pair();
  const { server, dir, discovery } = await setup(native, null);
  const probeFile = join(dir, "probe.json");
  writeFileSync(probeFile, JSON.stringify(probeEnvelope(probe)));
  const run = capture();
  assert.equal(await main(["compare", "--probe", probeFile, "--details", "--discovery", discovery], run.io), 0);
  await server.close();
  assert.match(run.out.join(""), /failed, nothing merged \(Operation "host_call" failed: no manifest\)/);
});

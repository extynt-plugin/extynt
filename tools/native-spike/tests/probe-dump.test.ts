/** Tests the probe dump's paging and merge of compositions and layers. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { decodeOrThrow, jsonObject, string } from "@extynt/decode";
import type { JsonObject } from "@extynt/decode";
import { numberAt, objectAt, rowsAt, textAt } from "../lib/json-access.ts";

type ProbeCall = (raw: string) => string;
interface DumpFunctions {
  readonly dumpBuildDump: (envelope: JsonObject, probe: ProbeCall, startedAt: number) => JsonObject;
  readonly dumpWholeRequest: () => JsonObject;
}

const SOURCE = readFileSync(new URL("../probe-dump.jsx", import.meta.url), "utf8");

function plain(value: JsonObject): JsonObject {
  return decodeOrThrow(jsonObject, JSON.parse(JSON.stringify(value)));
}

function load(): DumpFunctions {
  const context = vm.createContext({ JSON, Date });
  vm.runInContext(SOURCE.slice(0, SOURCE.indexOf("var dumpLoadFailure = null;")), context);
  const evaluate = (expression: string): JsonObject => decodeOrThrow(jsonObject, JSON.parse(decodeOrThrow(string(), vm.runInContext(`JSON.stringify(${expression})`, context))));
  return {
    dumpBuildDump: (envelope, probe, startedAt) => {
      Reflect.set(context, "dumpEnvelope", envelope);
      Reflect.set(context, "dumpProbe", probe);
      Reflect.set(context, "dumpStartedAt", startedAt);
      return evaluate("dumpBuildDump(dumpEnvelope, dumpProbe, dumpStartedAt)");
    },
    dumpWholeRequest: () => evaluate("dumpWholeRequest()"),
  };
}

function comp(id: string, layers: ReadonlyArray<string> = ["L1"]): JsonObject {
  return { id, name: `Comp ${id}`, layers: layers.map((name) => ({ id: `${id}-${name}`, name, propertyPaths: [] })) };
}

const COMPOSITION_IDS = ["1", "2", "3", "4"];
const items: ReadonlyArray<JsonObject> = [
  { id: "1", type: "composition" }, { id: "9", type: "folder" }, { id: "2", type: "composition" }, { id: "3", type: "composition" }, { id: "4", type: "composition" },
];
const stamp = { epoch: 1, revision: 5 };

function firstEnvelope(resultOverrides: JsonObject = {}): JsonObject {
  return {
    schemaVersion: "0.1", ok: true, requestId: "probe-dump-1",
    result: {
      items, compositions: [comp("1")], hostStamp: stamp, compositionPages: { unread: ["2", "3", "4"], partial: [], capped: false },
      truncation: { truncated: true }, ...resultOverrides,
    },
    warnings: ["composition-count-limit", "other"],
  };
}

function page(compositions: ReadonlyArray<JsonObject>, pages: JsonObject = {}, extra: JsonObject = {}): string {
  return JSON.stringify({
    ok: true,
    result: { compositions, compositionPages: { unread: [], partial: [], capped: false, ...pages }, hostStamp: stamp, ...extra },
  });
}

function scripted(answers: ReadonlyArray<string>): { readonly probe: ProbeCall; readonly requests: JsonObject[] } {
  const requests: JsonObject[] = [];
  const probe: ProbeCall = (raw) => {
    requests.push(decodeOrThrow(jsonObject, JSON.parse(raw)));
    return answers[requests.length - 1] ?? JSON.stringify({ ok: false, error: { code: "SCRIPT_END" } });
  };
  return { probe, requests };
}

function requestAt(requests: ReadonlyArray<JsonObject>, index: number): JsonObject {
  const found = requests[index];
  if (!found) throw new Error(`the probe was not called ${index + 1} times`);
  return found;
}

function compositionsOf(envelope: JsonObject): ReadonlyArray<JsonObject> {
  return rowsAt(objectAt(envelope, "result"), "compositions");
}

function compositionNamed(envelope: JsonObject, id: string): JsonObject {
  return compositionsOf(envelope).find((entry) => textAt(entry, "id") === id) ?? {};
}

test("unread and partial compositions are paged in, merged in project order and the pages cleaned up", () => {
  const { dumpBuildDump } = load();
  const cut = { id: "4", nextLayer: 3, nextProperty: 0, layerTotal: 4 };
  const { probe, requests } = scripted([
    page([comp("2"), comp("3")], { unread: ["4"] }),
    page([comp("4", ["A", "B"])], { partial: [cut] }),
    page([comp("4", ["C", "D"])]),
  ]);
  const merged = dumpBuildDump(firstEnvelope(), probe, Date.now() - 50);
  const result = objectAt(merged, "result");
  const dump = objectAt(merged, "dump");
  assert.deepEqual(compositionsOf(merged).map((entry) => textAt(entry, "id")), COMPOSITION_IDS);
  assert.deepEqual(rowsAt(compositionNamed(merged, "4"), "layers").map((layer) => textAt(layer, "name")), ["A", "B", "C", "D"]);
  assert.deepEqual(result.compositionPages, { unread: [], partial: [], oversized: [], capped: false });
  assert.deepEqual(merged.warnings, ["other"]);
  assert.equal(objectAt(result, "truncation").truncated, true);
  assert.equal(dump.calls, 4);
  assert.deepEqual(dump.pagedCompositionIds, ["2", "3", "4"]);
  assert.deepEqual(dump.stillMissingCompositionIds, []);
  assert.equal(dump.maxReadMsRequested, 120000);
  assert.equal(dump.note, "merged by tools/native-spike/probe-dump.jsx");
  assert.ok((numberAt(dump, "elapsedMs") ?? -1) >= 50);
  assert.deepEqual(requestAt(requests, 0).compositionIds, ["2", "3", "4"]);
  const opening = requestAt(requests, 0);
  assert.deepEqual([opening.includeItems, opening.includeEffects, opening.schemaVersion], [false, false, "0.1"]);
  assert.deepEqual(requestAt(requests, 2).compositionIds, ["4"]);
  assert.deepEqual(requestAt(requests, 2).layerStarts, { 4: { layer: 3, property: 0 } });
  assert.deepEqual(requests.map((request) => request.requestId), ["probe-dump-2", "probe-dump-3", "probe-dump-4"]);
  assert.equal(objectAt(opening, "limits").maxReadMs, 120000);
});

test("a layer cut mid-way continues with the later page's property paths", () => {
  const { dumpBuildDump } = load();
  const path = (name: string): JsonObject => ({ path: name });
  const cutLayer = (paths: ReadonlyArray<string>): JsonObject => ({ ...rowsAt(comp("4"), "layers")[0], id: "4-A", propertyPaths: paths.map(path) });
  const first = firstEnvelope({
    compositionPages: { unread: [], partial: [{ id: "4", nextLayer: 1, nextProperty: 2, layerTotal: 1 }], capped: false },
    compositions: [{ ...comp("4"), layers: [cutLayer(["a", "b"])] }],
  });
  const { probe } = scripted([page([{ ...comp("4"), layers: [cutLayer(["b", "c", "d"])] }])]);
  const merged = dumpBuildDump(first, probe, Date.now());
  const layer = rowsAt(compositionNamed(merged, "4"), "layers")[0] ?? {};
  assert.deepEqual(rowsAt(layer, "propertyPaths").map((entry) => textAt(entry, "path")), ["a", "b", "c", "d"]);
  assert.deepEqual(objectAt(merged, "dump").stillMissingCompositionIds, ["1", "2", "3"]);
});

test("a failing page stops the paging and leaves the rest listed as missing", () => {
  const { dumpBuildDump } = load();
  const { probe } = scripted([page([comp("2")], { unread: ["3", "4"] }), JSON.stringify({ ok: false, error: { code: "READ_BUDGET_EXCEEDED" } })]);
  const merged = dumpBuildDump(firstEnvelope(), probe, Date.now());
  const dump = objectAt(merged, "dump");
  assert.deepEqual(dump.pagedCompositionIds, ["2"]);
  assert.deepEqual(dump.stillMissingCompositionIds, ["3", "4"]);
  assert.deepEqual(objectAt(objectAt(merged, "result"), "compositionPages").unread, ["3", "4"]);
  assert.equal(dump.stoppedBecause, "page failed: READ_BUDGET_EXCEEDED");
  assert.deepEqual(merged.warnings, ["composition-count-limit", "other"]);
});

test("a page that reads nothing new, or a project that changed, ends the paging instead of looping", () => {
  const { dumpBuildDump } = load();
  const idle = scripted([page([], { unread: ["2", "3", "4"] })]);
  assert.equal(objectAt(dumpBuildDump(firstEnvelope(), idle.probe, Date.now()), "dump").stoppedBecause, "a page read nothing new");
  const changed = scripted([page([comp("2")], { unread: ["3", "4"] }, { hostStamp: { epoch: 1, revision: 6 } })]);
  const result = dumpBuildDump(firstEnvelope(), changed.probe, Date.now());
  assert.equal(objectAt(result, "dump").stoppedBecause, "project changed during the read");
  assert.equal(compositionsOf(result).length, 1);
});

test("a complete first answer is left as it was apart from the dump member", () => {
  const { dumpBuildDump } = load();
  const done = firstEnvelope({ compositions: COMPOSITION_IDS.map((id) => comp(id)), compositionPages: { unread: [], partial: [], capped: false } });
  const copy = plain(done);
  const { probe, requests } = scripted([]);
  const merged = dumpBuildDump(done, probe, Date.now());
  const dump = objectAt(merged, "dump");
  assert.equal(requests.length, 0);
  assert.deepEqual(compositionsOf(merged), compositionsOf(copy));
  assert.equal(dump.calls, 1);
  assert.deepEqual(dump.pagedCompositionIds, []);
});

test("the first request asks for the whole project with the documented limits and a soft budget", () => {
  const { dumpWholeRequest } = load();
  const request = dumpWholeRequest();
  assert.deepEqual([request.schemaVersion, request.requestId, request.includeItems, request.includeEffects], ["0.1", "probe-dump-1", true, true]);
  assert.deepEqual(request.limits, {
    maxReadMs: 120000, maxTotalProperties: 100000, maxCompositions: 256, maxProjectItems: 50000,
    maxLayersPerComposition: 4096, maxPropertiesPerLayer: 10000, maxPropertyDepth: 32, maxPayloadBytes: 10000000,
  });
  const softReadMs = numberAt(request, "softReadMs") ?? 0;
  assert.ok(softReadMs > 0 && softReadMs < 10000);
});

test("the script is read-only ES3 with the two user settings at the top", () => {
  assert.doesNotMatch(SOURCE, /beginUndoGroup|endUndoGroup|setValue|\.save\(|saveAs|\.remove\(|addProperty|\.import/);
  assert.doesNotMatch(SOURCE, /\b(let|const)\s|=>|`/);
  assert.doesNotMatch(SOURCE, /\.(forEach|map|filter|indexOf|reduce)\(/);
  assert.match(SOURCE, /^\/\/ probe-dump\.jsx\n\/\/\n\/\/ TEST-ONLY, READ-ONLY/);
  assert.ok(SOURCE.indexOf("var HOST_DIR") < SOURCE.indexOf("var OUTPUT_FILE"));
  assert.ok(SOURCE.indexOf("var OUTPUT_FILE") < SOURCE.indexOf("function dumpLimits"));
});

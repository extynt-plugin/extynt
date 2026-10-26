/** Tests the native-spike commands against a fake native server. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { decodeOrThrow, jsonObject } from "@extynt/decode";
import type { JsonObject } from "@extynt/decode";
import { main } from "../lib/cli.ts";
import { numberAt, objectAt, rowsAt, textAt } from "../lib/json-access.ts";
import type { Io } from "../lib/output.ts";
import { okResponse, startFakeServer } from "./fake-server.ts";
import type { FakeHandler, FakeRequest, FakeServer } from "./fake-server.ts";
import { makeResult, probeEnvelope } from "./fixtures.ts";

const TIMING = { queuedMs: 1, walkMs: 2, hashMs: 3, serializeMs: 4, totalMainThreadMs: 5, bytes: 600, getterCalls: 7 };

interface Capture {
  readonly out: string[];
  readonly err: string[];
  readonly io: Io;
}

function capture(): Capture {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { stdout: { write: (text) => out.push(text) }, stderr: { write: (text) => err.push(text) }, env: {} } };
}

function nativeHandler(result: JsonObject): FakeHandler {
  return (request) => {
    if (request.token !== "tok") return { ok: false, id: request.id, op: request.op, error: { code: "UNAUTHORIZED", message: "bad token" } };
    if (request.op === "ping_direct") return okResponse(request, { pong: true }, { ...TIMING, totalMainThreadMs: 0 });
    if (request.op === "read_project") return okResponse(request, result, TIMING);
    if (request.op === "revision") return okResponse(request, { source: "native", revision: 5, revisionUs: 120, floorUs: 20, revisionRaw: "5" }, TIMING);
    return okResponse(request, { source: "native", results: [], compositions: [] }, TIMING);
  };
}

async function setup(result: JsonObject = makeResult(), token = "tok"): Promise<{ readonly server: FakeServer; readonly dir: string; readonly discovery: string }> {
  const server = await startFakeServer(nativeHandler(result));
  const dir = mkdtempSync(join(tmpdir(), "spike-cli-"));
  const discovery = join(dir, "native.json");
  writeFileSync(discovery, JSON.stringify({ port: server.port, token, pid: process.pid, aeVersion: "26.0", pluginVersion: "0.1.0" }));
  return { server, dir, discovery };
}

function parseOutput(text: string): JsonObject {
  return decodeOrThrow(jsonObject, JSON.parse(text));
}

function requestOf(server: FakeServer, op: string): FakeRequest {
  const found = server.requests.find((request) => request.op === op);
  if (!found) throw new Error(`the server saw no ${op} request`);
  return found;
}

function firstRequest(server: FakeServer): FakeRequest {
  const [found] = server.requests;
  if (!found) throw new Error("the server saw no request");
  return found;
}

function opNamed(result: JsonObject, name: string): JsonObject {
  return rowsAt(result, "ops").find((entry) => textAt(entry, "name") === name) ?? {};
}

function warmStat(op: JsonObject, figure: string, statistic: string): number | undefined {
  return numberAt(objectAt(objectAt(op, "warm"), figure), statistic);
}

function mapLayers(result: JsonObject, change: (layer: JsonObject) => JsonObject): JsonObject {
  const [first = {}, ...others] = rowsAt(result, "compositions");
  return { ...result, compositions: [{ ...first, layers: rowsAt(first, "layers").map(change) }, ...others] };
}

function renameFirstLayer(result: JsonObject, name: string): JsonObject {
  const [first = {}, ...others] = rowsAt(result, "compositions");
  const [layer = {}, ...rest] = rowsAt(first, "layers");
  return { ...result, compositions: [{ ...first, layers: [{ ...layer, name }, ...rest] }, ...others] };
}

function mapEntries(layer: JsonObject, change: (entry: JsonObject) => JsonObject): JsonObject {
  return { ...layer, propertyPaths: rowsAt(layer, "propertyPaths").map(change) };
}

test("bench prints a table, derives latencies and emits JSON on stdout with the table on stderr", async () => {
  const { server, discovery, dir } = await setup();
  const { io, out, err } = capture();
  const outFile = join(dir, "bench.json");
  const code = await main(["bench", "--runs", "3", "--json", "--out", outFile, "--discovery", discovery], io);
  await server.close();
  assert.equal(code, 0);
  const result = parseOutput(out.join(""));
  assert.equal(result.version, "0.1.0");
  assert.equal(textAt(objectAt(result, "target"), "compName"), "Main");
  assert.equal(textAt(objectAt(result, "target"), "layerId"), "11");
  assert.equal(rowsAt(result, "ops").length, 9);
  assert.equal(warmStat(rowsAt(result, "ops")[0] ?? {}, "rttMs", "n"), 2);
  assert.equal(warmStat(opNamed(result, "read_project structure"), "bytes", "p50"), 600);
  assert.equal(warmStat(opNamed(result, "revision"), "revisionUs", "p50"), 120);
  assert.deepEqual(objectAt(result, "derived").executeScript, { revisionUsP50: 120, floorUsP50: 20, deltaUs: 100 });
  assert.match(err.join(""), /ExecuteScript: app\.project\.revision p50 120\.0 us, floor \(script `1`\) p50 20\.00 us, delta 100\.0 us/);
  assert.equal(typeof objectAt(result, "derived").idleHookLatencyMs, "number");
  assert.equal(JSON.stringify(result).includes("tok"), false);
  assert.match(err.join(""), /transport floor/);
  assert.deepEqual(parseOutput(readFileSync(outFile, "utf8")), result);
});

test("bench is the default command and sends the expected requests", async () => {
  const { server, discovery } = await setup();
  const { io, out } = capture();
  assert.equal(await main(["--runs", "2", "--discovery", discovery, "--layer-name", "Layer 12", "--path", "ADBE Transform Group/ADBE Opacity"], io), 0);
  const ops = server.requests.map((request) => request.op);
  await server.close();
  assert.equal(ops.filter((op) => op === "read_paths").length, 2);
  assert.deepEqual(requestOf(server, "read_paths").targets, [{ compId: "5", layerId: "12", path: "ADBE Transform Group/ADBE Opacity" }]);
  assert.match(out.join(""), /idle-hook latency/);
});

test("a bad token is reported as UNAUTHORIZED with exit code 2", async () => {
  const { server, discovery } = await setup(makeResult(), "wrong");
  const { io, err } = capture();
  const code = await main(["--discovery", discovery], io);
  await server.close();
  assert.equal(code, 2);
  assert.match(err.join(""), /UNAUTHORIZED/);
});

test("a stale discovery file (nothing listening) exits 2 with a connection message", async () => {
  const { server, discovery } = await setup();
  await server.close();
  const { io, err } = capture();
  assert.equal(await main(["--discovery", discovery], io), 2);
  assert.match(err.join(""), /CONNECT_FAILED/);
});

test("a missing discovery file exits 2 and says where it looked", async () => {
  const { io, err } = capture();
  assert.equal(await main(["--discovery", "/nonexistent/native.json"], io), 2);
  assert.match(err.join(""), /\/nonexistent\/native\.json/);
});

test("compare exits 0 on parity and 1 on a difference, with the human report on stderr under --json", async () => {
  const { server, discovery, dir } = await setup(makeResult());
  const probeFile = join(dir, "probe.json");
  writeFileSync(probeFile, JSON.stringify(probeEnvelope(makeResult())));
  const pass = capture();
  assert.equal(await main(["compare", "--probe", probeFile, "--json", "--discovery", discovery], pass.io), 0);
  assert.equal(objectAt(parseOutput(pass.out.join("")), "verdict").pass, true);
  assert.match(pass.err.join(""), /RESULT: PASS/);
  const changed = renameFirstLayer(makeResult(), "Different");
  writeFileSync(probeFile, JSON.stringify({ ok: true, snapshot: probeEnvelope(changed) }));
  const fail = capture();
  assert.equal(await main(["compare", "--probe", probeFile, "--discovery", discovery], fail.io), 1);
  await server.close();
  assert.match(fail.out.join(""), /RESULT: FAIL/);
  const readProject = requestOf(server, "read_project");
  assert.deepEqual([readProject.detail, readProject.hashes], ["full", false]);
});

test("compare passes the optional property limits through to read_project", async () => {
  const { server, discovery, dir } = await setup(makeResult());
  const probeFile = join(dir, "probe.json");
  writeFileSync(probeFile, JSON.stringify(makeResult()));
  await main(["compare", "--probe", probeFile, "--discovery", discovery, "--max-properties", "512", "--max-depth", "8"], capture().io);
  await server.close();
  assert.equal(firstRequest(server).maxPropertiesPerLayer, 512);
  assert.equal(firstRequest(server).maxPropertyDepth, 8);
});

test("dump prints the raw response and usage mistakes exit 2", async () => {
  const { server, discovery } = await setup();
  const { io, out } = capture();
  assert.equal(await main(["dump", "ping_direct", '{"x":1}', "--discovery", discovery], io), 0);
  await server.close();
  assert.equal(objectAt(parseOutput(out.join("")), "result").pong, true);
  assert.equal(firstRequest(server).x, 1);
  assert.equal(await main(["dump"], capture().io), 2);
  assert.equal(await main(["dump", "ping", "{bad", "--discovery", discovery], capture().io), 2);
  assert.equal(await main(["frobnicate"], capture().io), 2);
  assert.equal(await main(["--runs", "0"], capture().io), 2);
});

test("--help prints usage and exits 0", async () => {
  const { io, out } = capture();
  assert.equal(await main(["--help"], io), 0);
  assert.match(out.join(""), /usage:/);
  assert.match(out.join(""), /--probe FILE/);
});

test("compare --debug-flags asks for dynFlags, names the input and prints the flag section", async () => {
  const native = mapLayers(makeResult(), (layer) => mapEntries(layer, (entry) => ({ ...entry, enabled: true, dynFlags: 1 })));
  const probe = mapLayers(makeResult(), (layer) => mapEntries(layer, (entry) => ({ ...entry, enabled: true })));
  const { server, discovery, dir } = await setup(native);
  const probeFile = join(dir, "probe.json");
  writeFileSync(probeFile, JSON.stringify(probeEnvelope(probe)));
  const flagged = capture();
  assert.equal(await main(["compare", "--probe", probeFile, "--debug-flags", "--discovery", discovery], flagged.io), 0);
  const plain = capture();
  await main(["compare", "--probe", probeFile, "--discovery", discovery], plain.io);
  await server.close();
  assert.equal(firstRequest(server).debugFlags, true);
  assert.equal(server.requests[1]?.debugFlags, undefined);
  assert.match(flagged.out.join(""), /probe input: raw probe envelope file/);
  assert.match(flagged.out.join(""), /enabled vs raw flags \(debugFlags\)/);
});

test("compare reports a probe that answered ok:false with its error code and exits 2", async () => {
  const { server, discovery, dir } = await setup();
  const probeFile = join(dir, "probe.json");
  writeFileSync(probeFile, JSON.stringify({ schemaVersion: "0.1", ok: false, error: { code: "NO_PROJECT", message: "No After Effects project is open." } }));
  const { io, err } = capture();
  assert.equal(await main(["compare", "--probe", probeFile, "--discovery", discovery], io), 2);
  await server.close();
  assert.match(err.join(""), /PROBE_ERROR.*NO_PROJECT/);
});

/** Tests the accepted probe input shapes and file loading. */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { JsonObject } from "@extynt/decode";
import { SpikeError } from "../lib/errors.ts";
import { objectAt, numberAt, textAt } from "../lib/json-access.ts";
import { classifyProbe, extractProbeResult, fetchSidecarSnapshot, loadProbeFile, parseProbeText, resolveSidecar } from "../lib/probe-input.ts";
import type { SidecarFetch } from "../lib/probe-input.ts";
import { makeResult, probeEnvelope } from "./fixtures.ts";

const NO_SESSION = { sessionFile: "/nonexistent/session.json" };

const projectName = (result: JsonObject): string | undefined => textAt(objectAt(result, "project"), "name");

test("the three accepted probe shapes all yield the same result", () => {
  const result = makeResult();
  assert.equal(extractProbeResult(probeEnvelope(result)), result);
  assert.equal(extractProbeResult({ ok: true, receivedAt: "t", bytes: 1, snapshot: probeEnvelope(result) }), result);
  assert.equal(extractProbeResult(result), result);
  assert.throws(() => extractProbeResult({ hello: 1 }), { code: "PROBE_FORMAT" });
});

test("loadProbeFile reads a saved envelope and rejects unreadable or non-JSON files", () => {
  const dir = mkdtempSync(join(tmpdir(), "spike-probe-"));
  writeFileSync(join(dir, "probe.json"), JSON.stringify(probeEnvelope(makeResult())));
  writeFileSync(join(dir, "bad.json"), "{nope");
  assert.equal(projectName(loadProbeFile(join(dir, "probe.json")).result), "Test.aep");
  assert.throws(() => loadProbeFile(join(dir, "bad.json")), { code: "PROBE_FORMAT" });
  assert.throws(() => loadProbeFile(join(dir, "absent.json")), { code: "PROBE_UNREADABLE" });
});

test("the sidecar address comes from flags, then AE_BRIDGE_PORT, then the default", () => {
  assert.equal(resolveSidecar({ ...NO_SESSION, sidecar: "http://h:9/" }, {}).url, "http://h:9");
  assert.equal(resolveSidecar(NO_SESSION, { AE_BRIDGE_PORT: "4000" }).url, "http://127.0.0.1:4000");
  assert.equal(resolveSidecar(NO_SESSION, {}).url, "http://127.0.0.1:3210");
  assert.equal(resolveSidecar({ ...NO_SESSION, sidecarToken: "a" }, { AE_BRIDGE_TOKEN: "b" }).token, "a");
});

test("fetching the sidecar sends the bearer token and unwraps the snapshot", async () => {
  const seen: Array<{ readonly url: string; readonly authorization: string }> = [];
  const fetchImpl: SidecarFetch = (url, init) => {
    seen.push({ url, authorization: init.headers.Authorization });
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true, snapshot: probeEnvelope(makeResult()) })) });
  };
  const { result, input } = await fetchSidecarSnapshot({ ...NO_SESSION, sidecarToken: "tok", env: {} }, fetchImpl);
  assert.equal(projectName(result), "Test.aep");
  assert.equal(input, "sidecar /v1/snapshots/latest");
  assert.equal(seen[0]?.url, "http://127.0.0.1:3210/v1/snapshots/latest");
  assert.equal(seen[0]?.authorization, "Bearer tok");
});

test("sidecar failures are actionable: no token, 401, 404, unreachable", async () => {
  const status = (code: number): SidecarFetch => () => Promise.resolve({ ok: false, status: code, text: () => Promise.resolve("") });
  await assert.rejects(fetchSidecarSnapshot({ ...NO_SESSION, env: {} }, status(200)), { code: "SIDECAR_NO_TOKEN" });
  const options = { ...NO_SESSION, sidecarToken: "t", env: {} };
  await assert.rejects(fetchSidecarSnapshot(options, status(401)), { code: "SIDECAR_UNAUTHORIZED" });
  await assert.rejects(fetchSidecarSnapshot(options, status(404)), (error: Error) => error instanceof SpikeError && error.code === "NO_SNAPSHOT" && /panel/.test(error.message));
  await assert.rejects(fetchSidecarSnapshot(options, () => Promise.reject(new Error("fetch failed"))), { code: "SIDECAR_UNREACHABLE" });
});

function saved(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "spike-probe-"));
  writeFileSync(join(dir, name), content);
  return join(dir, name);
}

test("each accepted shape says which input it was", () => {
  const result = makeResult();
  assert.equal(classifyProbe(probeEnvelope(result)).input, "raw probe envelope file");
  assert.equal(classifyProbe({ ok: true, snapshot: probeEnvelope(result) }).input, "sidecar snapshot file");
  assert.equal(classifyProbe(result).input, "bare result file");
  assert.equal(loadProbeFile(saved("a.json", JSON.stringify(probeEnvelope(result)))).input, "raw probe envelope file");
});

test("a UTF-8 BOM and a double-encoded envelope string are tolerated", () => {
  const envelope = JSON.stringify(probeEnvelope(makeResult()));
  assert.equal(projectName(loadProbeFile(saved("bom.json", `﻿${envelope}`)).result), "Test.aep");
  const doubled = loadProbeFile(saved("double.json", JSON.stringify(envelope)));
  assert.equal(projectName(doubled.result), "Test.aep");
  assert.equal(doubled.input, "raw probe envelope file");
  assert.equal(numberAt(loadProbeFile(saved("both.json", `﻿${JSON.stringify(envelope)}`)).result, "itemCount"), 3);
  assert.deepEqual(parseProbeText(JSON.stringify(JSON.stringify({ a: 1 }))), { a: 1 });
  assert.throws(() => loadProbeFile(saved("nested.json", JSON.stringify(JSON.stringify("x")))), { code: "PROBE_FORMAT" });
});

test("a runner-merged dump is just an envelope and its dump member is ignored", () => {
  const merged = { ...probeEnvelope(makeResult()), dump: { calls: 3, pagedCompositionIds: ["8"], stillMissingCompositionIds: [] } };
  const { result, input } = loadProbeFile(saved("dump.json", JSON.stringify(merged)));
  assert.equal(input, "raw probe envelope file");
  assert.equal(projectName(result), "Test.aep");
});

test("an ok:false envelope or probe error names the probe's error code and message", () => {
  const budget = { schemaVersion: "0.1", ok: false, requestId: "x", error: { code: "READ_BUDGET_EXCEEDED", message: "Read stopped at its cooperative budget" }, warnings: [] };
  assert.throws(() => loadProbeFile(saved("budget.json", JSON.stringify(budget))), (error: Error) => (
    error instanceof SpikeError && error.code === "PROBE_ERROR" && /READ_BUDGET_EXCEEDED: Read stopped at its cooperative budget/.test(error.message)
  ));
  const bare = { ok: false, error: { code: "NO_PROJECT", message: "No After Effects project is open." } };
  assert.throws(() => loadProbeFile(saved("none.json", JSON.stringify(bare))), /NO_PROJECT: No After Effects project is open\./);
  assert.throws(() => classifyProbe({ ok: true, snapshot: bare }), /NO_PROJECT/);
  assert.throws(() => classifyProbe({ ok: false }), /UNKNOWN: no message/);
});

/** Tests the stability pass defaults and summary. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatStability, parseStabilityArgs, runStability, summarizeStability } from "../lib/stability.ts";
import type { StabilityRecord } from "../lib/stability.ts";
import { createFakeNative } from "./fake-native.ts";
import { startFakeServer } from "./fake-server.ts";

test("arguments have the stability pass defaults and reject bad values", () => {
  const options = parseStabilityArgs([]);
  assert.deepEqual([options.n, options.intervalMs, options.slowMs], [300, 100, 250]);
  for (const bad of [["--n", "0"], ["--dispatch", "idle"], ["--hot", "0"], ["--bogus"]]) assert.throws(() => parseStabilityArgs(bad), { code: "USAGE" });
});

test("the summary counts paths, lists slow requests and finds the longest silence", () => {
  const rec = (i: number, epochMs: number, rttMs: number, dispatchedBy: string): StabilityRecord => ({ i, epochMs, at: `t${i}`, ok: true, rttMs, dispatchedBy });
  const failed: StabilityRecord = { i: 3, epochMs: 3200, at: "t3", ok: false, error: "TIMEOUT: x" };
  const records = [rec(0, 0, 3, "idle"), rec(1, 100, 4, "idle"), rec(2, 3100, 2900, "idle"), failed];
  const summary = summarizeStability(records, 250);
  assert.deepEqual(summary.byPath, { idle: 3 });
  assert.equal(summary.slow.length, 1);
  assert.equal(summary.longestGapMs, 3000);
  assert.equal(summary.errors.length, 1);
  assert.match(formatStability(summary, 250), /slow requests \(rtt >= 250 ms\): 1/);
});

test("a run logs every request and sends nothing but read_project and read_paths", async () => {
  const native = createFakeNative();
  const server = await startFakeServer(native.handler);
  const dir = mkdtempSync(join(tmpdir(), "stability-"));
  const discovery = join(dir, "native.json");
  writeFileSync(discovery, JSON.stringify({ port: server.port, token: "tok", pid: process.pid, aeVersion: "t", pluginVersion: "t" }));
  const log = join(dir, "run.ndjson");
  const summary = await runStability({ n: 3, intervalMs: 0, slowMs: 250, timeoutMs: 2000, discovery, log, skipPidCheck: true });
  await server.close();
  assert.equal(summary.answered, 3);
  assert.deepEqual(summary.byPath, { idle: 3 });
  assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 3);
  assert.deepEqual([...new Set(server.requests.map((request) => request.op))], ["read_project", "read_paths"]);
});

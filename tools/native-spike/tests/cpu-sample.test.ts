/** Tests CPU sampling, its statistics and its pacing. */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { decodeOrThrow, jsonObject } from "@extynt/decode";
import type { JsonObject } from "@extynt/decode";
import { benchCommand } from "../lib/cmd-bench.ts";
import { parseCli } from "../lib/args.ts";
import { objectAt, rowsAt } from "../lib/json-access.ts";
import type { Io } from "../lib/output.ts";
import { cpuLines } from "../lib/cpu-report.ts";
import { parseCpuTime, parsePs, psRunner, runCpuSample } from "../lib/cpu-sample.ts";
import type { CpuConfigResult, CpuDeps, CpuResult } from "../lib/cpu-sample.ts";
import { createFakeNative } from "./fake-native.ts";
import { startFakeServer } from "./fake-server.ts";

interface FakeClock {
  time: number;
  readonly sleeps: number[];
  psCalls: number;
}

function fakeDeps(values: ReadonlyArray<number> = [], extra: Partial<CpuDeps> = {}): { readonly clock: FakeClock; readonly deps: CpuDeps } {
  const clock: FakeClock = { time: 0, sleeps: [], psCalls: 0 };
  return {
    clock,
    deps: {
      sleep: async (ms: number) => { clock.sleeps.push(ms); clock.time += ms; },
      now: () => clock.time,
      runPs: async () => {
        const value = values[clock.psCalls % Math.max(values.length, 1)] ?? 2;
        clock.psCalls += 1;
        return ` ${value}  0:${String(10 + clock.psCalls * 0.5).padStart(5, "0")}`;
      },
      ...extra,
    },
  };
}

const OPTIONS = { cpuSeconds: 10, hotWindowMs: 2000 };

function onlyConfig(cpu: CpuResult): CpuConfigResult {
  const [entry] = cpu.configs;
  if (!entry) throw new Error("the sample has no configuration row");
  return entry;
}

function parseOutput(text: string): JsonObject {
  return decodeOrThrow(jsonObject, JSON.parse(text));
}

test("cpuSeconds samples are taken and reported with mean, min, max and the cputime busy percentage", async () => {
  const { deps, clock } = fakeDeps([1, 3]);
  const cpu = await runCpuSample({ options: OPTIONS, pid: 4242 }, deps);
  assert.deepEqual(cpu.configs.map((entry) => entry.config), ["idle"]);
  const entry = onlyConfig(cpu);
  assert.equal(entry.samples, 10);
  assert.deepEqual([entry.mean, entry.min, entry.max], [2, 1, 3]);
  assert.ok(Math.abs((entry.busyPercent ?? Number.NaN) - 50) < 1e-9);
  assert.equal(clock.psCalls, 10);
  assert.equal(cpu.pid, 4242);
});

test("sampling waits one second between samples", async () => {
  const { deps, clock } = fakeDeps();
  await runCpuSample({ options: { cpuSeconds: 3 }, pid: 1 }, deps);
  assert.deepEqual(clock.sleeps, [1000, 1000]);
});

test("a missing pid is a clear error before anything is sampled", async () => {
  const { deps, clock } = fakeDeps();
  await assert.rejects(runCpuSample({ options: OPTIONS, pid: null }, deps), { code: "CPU_NO_PID", message: /pid/ });
  assert.equal(clock.psCalls, 0);
});

test("a failing ps aborts the sample with a clear error", async () => {
  const { deps } = fakeDeps([], { runPs: async () => { throw new Error("no such process"); } });
  await assert.rejects(runCpuSample({ options: OPTIONS, pid: 7 }, deps), { code: "CPU_SAMPLE_FAILED", message: /pid 7/ });
});

test("blank ps output is ignored, not counted as a sample", async () => {
  let calls = 0;
  const { deps } = fakeDeps([], { runPs: async () => { calls += 1; return calls === 2 ? "  \n" : " 5.0\n"; } });
  const cpu = await runCpuSample({ options: { cpuSeconds: 4 }, pid: 1 }, deps);
  assert.equal(onlyConfig(cpu).samples, 3);
  assert.equal(onlyConfig(cpu).busyPercent, null);
});

test("ps lines and cputime strings are parsed", () => {
  assert.deepEqual(parsePs(" 3.4  1:02.50\n"), { cpu: 3.4, cpuSeconds: 62.5 });
  assert.deepEqual(parsePs("12.0"), { cpu: 12, cpuSeconds: null });
  assert.equal(parsePs(""), null);
  assert.equal(parsePs("abc"), null);
  assert.equal(parseCpuTime("1-02:03:04"), 93784);
  assert.equal(parseCpuTime("02:03:04"), 7384);
  assert.equal(parseCpuTime("0:07.25"), 7.25);
  assert.equal(parseCpuTime("x"), null);
});

test("psRunner asks ps for the pid's %cpu and cputime", async () => {
  const seen: Array<[string, ReadonlyArray<string>]> = [];
  const run = psRunner((file, args, callback) => { seen.push([file, args]); callback(null, " 1.0 0:01.00\n"); });
  assert.equal(await run(99), " 1.0 0:01.00\n");
  assert.deepEqual(seen[0], ["ps", ["-o", "%cpu=", "-o", "cputime=", "-p", "99"]]);
  await assert.rejects(psRunner((_file, _args, callback) => callback(new Error("gone"), ""))(1), /gone/);
});

test("the report prints one row for the idle baseline", async () => {
  const { deps } = fakeDeps([2]);
  const cpu = await runCpuSample({ options: OPTIONS, pid: 5 }, deps);
  const text = cpuLines(cpu).join("\n");
  assert.match(text, /no requests sent while sampling/);
  assert.match(text, /idle\s+10\s+2\.0\s+2\.0\s+2\.0/);
});

async function cliRig() {
  const native = createFakeNative();
  const server = await startFakeServer(native.handler);
  const dir = mkdtempSync(join(tmpdir(), "spike-cpu-"));
  const discovery = join(dir, "native.json");
  const write = (pid: number | undefined) => writeFileSync(discovery, JSON.stringify({ port: server.port, token: "tok", pid }));
  write(process.pid);
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { stdout: { write: (text) => out.push(text) }, stderr: { write: (text) => err.push(text) }, env: {} };
  return { native, server, discovery, write, io, out, err };
}

test("--cpu-sample alone runs only the CPU phase, and with an explicit bench it runs after the bench", async () => {
  const { server, discovery, io, out } = await cliRig();
  const { deps } = fakeDeps([4]);
  const only = parseCli(["--cpu-sample", "--cpu-seconds", "2", "--json", "--discovery", discovery]).options;
  assert.equal(await benchCommand({ options: only, io, deps }), 0);
  const result = parseOutput(out.join(""));
  assert.equal(rowsAt(objectAt(result, "cpu"), "configs").length, 1);
  assert.equal(result.ops, undefined);
  assert.equal(server.requests.length, 0);
  const both = parseCli(["bench", "--cpu-sample", "--runs", "2", "--cpu-seconds", "1", "--discovery", discovery]).options;
  assert.equal(await benchCommand({ options: both, io, deps }), 0);
  await server.close();
  assert.equal(server.requests.some((request) => request.op === "read_project"), true);
  assert.equal(server.requests.some((request) => request.op === "configure"), false);
});

test("--cpu-sample reports a discovery file without a pid before touching the plugin", async () => {
  const { server, discovery, write, io } = await cliRig();
  write(undefined);
  const options = parseCli(["--cpu-sample", "--discovery", discovery, "--no-pid-check"]).options;
  await assert.rejects(benchCommand({ options, io, deps: fakeDeps().deps }), { code: "CPU_NO_PID" });
  await server.close();
  assert.equal(server.requests.length, 0);
});

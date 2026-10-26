/** Tests how the host client tells an After Effects busy stall from a slow call. */
import assert from "node:assert/strict";
import test from "node:test";
import type { StallReport } from "@extynt/host-native";
import { late, ok, stall } from "../src/index.js";
import { until, withRig } from "./rig.js";

test("a stalled call pings the control connection and reports ae-busy when idleAgeMs is over the stall bound", async () => {
  const reports: StallReport[] = [];
  await withRig(async ({ client, plugin }) => {
    plugin.state.idleAgeMs = 4200;
    plugin.state.queueDepth = 3;
    const outcome = await client.request({ op: "read_project" }, { stallAfterMs: 30, onStall: (report) => reports.push(report) });
    assert.equal(outcome.kind, "ok");
    assert.equal(reports[0]?.verdict, "ae-busy");
    assert.deepEqual([reports[0]?.idleAgeMs, reports[0]?.queueDepth], [4200, 3]);
    assert.ok((reports[0]?.waitedMs ?? 0) >= 30);
  }, { plugin: { handlers: { read_project: () => late(150, ok({})) } } });
});

test("a call that is slow while the idle hook is alive is reported as slow", async () => {
  const reports: StallReport[] = [];
  await withRig(async ({ client, plugin }) => {
    plugin.state.idleAgeMs = 12;
    await client.request({ op: "read_project" }, { stallAfterMs: 30, onStall: (report) => reports.push(report) });
    assert.equal(reports[0]?.verdict, "slow");
  }, { plugin: { handlers: { read_project: () => late(120, ok({})) } } });
});

test("a null idle age (idle hook has not ticked yet) is slow, not busy", async () => {
  const reports: StallReport[] = [];
  await withRig(async ({ client, plugin }) => {
    plugin.state.idleAgeMs = null;
    await client.request({ op: "read_project" }, { stallAfterMs: 30, onStall: (report) => reports.push(report) });
    assert.deepEqual([reports[0]?.verdict, reports[0]?.idleAgeMs], ["slow", null]);
  }, { plugin: { handlers: { read_project: () => late(120, ok({})) } } });
});

test("a ping that is not answered within a second is plugin-unresponsive", async () => {
  const reports: StallReport[] = [];
  await withRig(async ({ client }) => {
    const outcome = await client.request({ op: "read_project" }, { stallAfterMs: 20, timeoutMs: 1400, onStall: (report) => reports.push(report) });
    assert.equal(outcome.kind === "lost" && outcome.reason, "timeout");
    assert.equal(reports[0]?.verdict, "plugin-unresponsive");
    assert.deepEqual([reports[0]?.idleAgeMs, reports[0]?.queueDepth], [null, null]);
  }, { plugin: { handlers: { read_project: () => stall(), ping_direct: () => stall() } } });
});

test("ping_direct is answered on the control connection while the command connection is blocked", async () => {
  await withRig(async ({ client, plugin }) => {
    const blocked = client.request({ op: "read_project" }, { timeoutMs: 400 });
    await until(() => plugin.requestsFor("read_project").length === 1);
    const ping = await client.pingDirect();
    assert.equal(ping.kind === "ok" && ping.result.mainThread, false);
    assert.notEqual(plugin.requestsFor("ping_direct")[0]?.connection, plugin.requestsFor("read_project")[0]?.connection);
    assert.equal((await blocked).kind, "lost");
  }, { plugin: { handlers: { read_project: () => stall() } } });
});

test("pings stop when the call settles, and no pings go out without an onStall listener", async () => {
  const reports: StallReport[] = [];
  await withRig(async ({ client, plugin }) => {
    await client.request({ op: "read_project" }, { stallAfterMs: 30 });
    await client.request({ op: "read_project" }, { stallAfterMs: 30, onStall: (report) => reports.push(report) });
    await new Promise((resolve) => { setTimeout(resolve, 1300); });
    assert.equal(reports.length, 1);
    assert.equal(plugin.requestsFor("ping_direct").length, 1);
  }, { plugin: { handlers: { read_project: () => late(100, ok({})) } } });
});

test("a dialog the plugin reports open during the call rides the stall report and makes the verdict ae-busy", async () => {
  const reports: StallReport[] = [];
  await withRig(async ({ client, plugin }) => {
    plugin.state.idleAgeMs = 12;
    plugin.state.waitingOnDialog = { title: "Select a LUT file", sinceMs: 1500 };
    await client.request({ op: "read_project" }, { stallAfterMs: 30, onStall: (report) => reports.push(report) });
    assert.equal(reports[0]?.verdict, "ae-busy");
    assert.deepEqual(reports[0]?.dialog, { title: "Select a LUT file", sinceMs: 1500 });
  }, { plugin: { handlers: { read_project: () => late(150, ok({})) } } });
});

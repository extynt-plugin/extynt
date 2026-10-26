/** The first census after After Effects launches can be refused while its script engine starts: the reason is kept, one retry follows, and a second refusal is reported. */
import assert from "node:assert/strict";
import test from "node:test";
import { ok, refuse, toWire } from "@extynt/fake-plugin";
import { CENSUS_REASK_MS } from "../src/host/run-census.js";
import { startHostRig, type HostRig } from "./host-rig.js";
import { censusAnswer } from "./sidecar-fixture.js";

const REFUSED = "the script engine is not ready";
const inventoryCount = (rig: HostRig): number | undefined => rig.sidecar.inventory?.items.length;

test("a census refused with SCRIPT_FAILED is retried once after a delay and then succeeds", async () => {
  let calls = 0;
  const rig = await startHostRig({ plugin: { hostCalls: { aeHostCensus: (args) => (++calls === 1 ? refuse("SCRIPT_FAILED", REFUSED) : ok(toWire(censusAnswer(args, 2)))) } } });
  try {
    assert.equal(rig.readers.queueCensus(), true);
    assert.deepEqual(await rig.drain(), ["host_census"]);
    const retry = rig.logs.find((entry) => entry.event === "host.census-retry");
    assert.deepEqual([retry?.fields.code, retry?.fields.message, retry?.fields.afterMs], ["SCRIPT_FAILED", REFUSED, CENSUS_REASK_MS]);
    assert.equal(rig.sidecar.panel.lastError, null, "a retry is not yet a failure");
    assert.equal(inventoryCount(rig), undefined);
    assert.ok(rig.timers.waiting() >= 1, "the retry is waiting on its timer");
    rig.timers.fire();
    assert.deepEqual(await rig.drain(), ["host_census", "host_census"], "the retried effects census, then the fonts");
    assert.equal(inventoryCount(rig), 2);
    assert.equal(rig.sidecar.hostFacts.checks.census?.ok, true);
    assert.equal(rig.plugin.requestsFor("host_call").length, 3);
  } finally { await rig.close(); }
});

test("a census refused twice is logged with its message, reported once, and not retried again", async () => {
  const rig = await startHostRig({ plugin: { hostCalls: { aeHostCensus: () => refuse("SCRIPT_FAILED", REFUSED) } } });
  try {
    rig.readers.queueCensus();
    await rig.drain();
    rig.timers.fire();
    await rig.drain();
    const failed = rig.logs.find((entry) => entry.event === "host.census-failed");
    assert.deepEqual([failed?.fields.code, failed?.fields.message], ["SCRIPT_FAILED", REFUSED]);
    assert.deepEqual([rig.sidecar.panel.lastError?.code, rig.sidecar.panel.lastError?.message], ["SCRIPT_FAILED", REFUSED]);
    assert.deepEqual(rig.sidecar.hostFacts.checks.census?.ok === false && [rig.sidecar.hostFacts.checks.census.code, rig.sidecar.hostFacts.checks.census.message], ["SCRIPT_FAILED", REFUSED]);
    rig.timers.fire();
    await rig.drain();
    assert.equal(rig.plugin.requestsFor("host_call").length, 2, "one try and one retry");
  } finally { await rig.close(); }
});

test("a census failure other than SCRIPT_FAILED is reported at once, and a missing library is recorded as one", async () => {
  const rig = await startHostRig({ plugin: { hostCalls: { aeHostCensus: () => refuse("LIBRARY_NOT_FOUND", "the host library was not found") } } });
  try {
    rig.readers.queueCensus();
    await rig.drain();
    rig.timers.fire();
    await rig.drain();
    assert.equal(rig.plugin.requestsFor("host_call").length, 1, "no retry");
    assert.equal(rig.sidecar.panel.lastError?.code, "LIBRARY_NOT_FOUND");
    assert.equal(rig.sidecar.hostFacts.checks.library?.ok, false);
  } finally { await rig.close(); }
});

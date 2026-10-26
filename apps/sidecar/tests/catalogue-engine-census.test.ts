// Tests that the engine collector only accepts a census that actually lists installed effects.
import { jsonOf } from "@extynt/mcp-server";
import assert from "node:assert/strict";
import test from "node:test";
import { CatalogueEngine, type CatalogueEngineDeps } from "../src/catalogue-engine.js";
import type { CatalogueProgress } from "../src/catalogue-collector.js";
import { acceptEngineCensus } from "../src/server-engine-census.js";
import { hostCensus, sidecarFor, token } from "./sidecar-fixture.js";

const fresh = () => sidecarFor({ port: 0, token, quietAgentLog: true });

test("a census from the hidden engine feeds the catalogue and leaves the user's inventory and profile alone", async () => {
  const sidecar = fresh();
  await sidecar.receivers.acceptHostCensus(jsonOf(hostCensus(3)), 10);
  const inventory = sidecar.inventory, profile = sidecar.hostProfile;
  assert.equal(inventory?.items.length, 3);
  const sevenEffects = hostCensus(7);
  const engine = { ...sevenEffects, result: { ...sevenEffects.result, runtime: { ...sevenEffects.result.runtime, appVersion: "25.6x1" } } };
  assert.deepEqual(acceptEngineCensus(sidecar, jsonOf(engine)), { outcome: "succeeded" });
  assert.equal(sidecar.inventory, inventory, "the user's inventory is the same object");
  assert.equal(sidecar.hostProfile, profile, "the user's host profile is untouched");
  assert.equal(sidecar.catalogue.progress().installed, 7, "the catalogue follows the engine's version");
  assert.deepEqual(acceptEngineCensus(sidecar, { ok: true }), { outcome: "rejected", errorCode: "INVALID_HOST_CENSUS" });
});

function progressOf(pending: number): CatalogueProgress {
  return { state: "idle", hostKey: null, installed: 0, collected: 0, pending, failed: 0, needsSource: 0, deferred: 0, lastPageMs: null, totalProbeMs: 0, probedThisRun: 0, pauseReason: null, outstanding: false };
}

function engineWith(open: { value: boolean }, collected: string[], pending = 2) {
  const host = { year: "2026", appPath: "/nowhere" };
  const deps: CatalogueEngineDeps = {
    catalogue: { progress: () => progressOf(pending), nextItem: () => undefined, abandon: () => undefined, complete: () => ({ ok: true, accepted: false, written: 0, failed: 0, remaining: pending, state: "idle" }) },
    acceptCensus: () => Promise.resolve({ outcome: "succeeded" }),
    discoveryPath: "/nowhere/native-engine.json", logPath: "/nowhere/engine.log",
    hosts: () => [host], userOpen: () => open.value, log: () => undefined, now: () => Date.now(), limits: { watchMs: 10 },
  };
  const engine = new CatalogueEngine(deps);
  engine.collect = (years) => { collected.push(...(years ?? [])); return Promise.resolve(engine.status()); };
  return engine;
}

test("a census from the user's own After Effects defers the engine until that After Effects closes, and does not count the version as tried", async () => {
  const open = { value: true }, collected: string[] = [];
  const engine = engineWith(open, collected);
  engine.onCensus("26.5x89");
  engine.onCensus("26.5x89");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(collected, [], "nothing starts while the user has it open");
  open.value = false;
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(collected, ["2026"], "it starts once, after it closes");
  engine.stop();
});

test("an After Effects the user does not have open is collected at once", () => {
  const collected: string[] = [];
  const engine = engineWith({ value: false }, collected);
  engine.onCensus("26.5x89");
  assert.deepEqual(collected, ["2026"]);
  engine.stop();
});

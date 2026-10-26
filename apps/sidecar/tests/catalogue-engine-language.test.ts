// Tests that the catalogue engine's answers name the interface language, which is how the Windows catalogue window learns it.
import assert from "node:assert/strict";
import test from "node:test";
import { decodeOrThrow, jsonValue } from "@extynt/decode";
import { CatalogueEngine } from "../src/catalogue-engine.js";
import { fieldOf } from "./http-json.js";
import { authorization } from "./sidecar-fixture.js";
import { startUiSidecar } from "./ui-fixture.js";

const idleProgress = { state: "idle", hostKey: null, installed: 0, collected: 0, pending: 0, failed: 0, needsSource: 0, deferred: 0, lastPageMs: null, totalProbeMs: 0, probedThisRun: 0, pauseReason: null, outstanding: false } as const;

function quietEngine(): CatalogueEngine {
  return new CatalogueEngine({
    catalogue: { progress: () => idleProgress, nextItem: () => undefined, abandon: () => undefined, complete: () => ({ ok: true, accepted: false, written: 0, failed: 0, remaining: 0, state: "idle" }) },
    acceptCensus: () => Promise.resolve({ outcome: "succeeded" }),
    discoveryPath: "/nowhere/native-engine.json", logPath: "/nowhere/engine.log",
    hosts: () => [], userOpen: () => false, log: () => undefined, now: () => Date.now(), limits: { watchMs: 10 },
  });
}

async function engineAnswer(port: number, method: string) {
  const response = await fetch(`http://127.0.0.1:${port}/v1/catalogue/engine`, { method, headers: { ...authorization, "content-type": "application/json" }, ...(method === "POST" ? { body: "{}" } : {}) });
  return decodeOrThrow(jsonValue, await response.json());
}

test("the engine's GET and POST answers carry the interface language", async (t) => {
  const harness = await startUiSidecar(t);
  const original = harness.sidecar.catalogueEngine;
  const engine = quietEngine();
  harness.sidecar.catalogueEngine = engine;
  t.after(() => {
    engine.stop();
    harness.sidecar.catalogueEngine = original;
  });
  assert.equal(fieldOf(await engineAnswer(harness.port, "GET"), "language"), "en");
  harness.sidecar.hostFacts.isoLanguage = "de_DE";
  assert.equal(fieldOf(await engineAnswer(harness.port, "GET"), "language"), "de");
  assert.equal(fieldOf(await engineAnswer(harness.port, "POST"), "language"), "de");
});

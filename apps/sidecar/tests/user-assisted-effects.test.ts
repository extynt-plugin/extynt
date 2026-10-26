// Tests that effects needing a dialog or user interaction are read from a project instance, never probed or added, and surface as user-assisted.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyEffectControlEvidence, makeHostProfile, makeInventory } from "@extynt/capability-catalogue";

import { CatalogueCollector } from "../src/catalogue-collector.js";
import { catalogueEvidence } from "../src/server-http-core.js";
import type { HostCensus } from "../src/server-types.js";
import type { LayerSnapshot, ProjectSnapshot, PropertySnapshot } from "@extynt/project-graph";
import { normalizeProbeSnapshot } from "../src/server-normalize.js";
import { mutableSnapshot } from "./sidecar-fixture.js";

const runtime = { application: "After Effects", appVersion: "26.2.1", buildNumber: "2", buildName: null, platform: "macOS", architecture: "arm64", compatible: true } as const;
const census: HostCensus = { schemaVersion: "0.1", ok: true, requestId: "census-1", warnings: [], result: { runtime, totalReported: 3, returnedCount: 3, completeness: "complete", installedEffects: [
  { matchName: "ADBE Apply Color LUT2", displayName: "Apply Color LUT" }, { matchName: "ACME Window", displayName: "Acme Window" }, { matchName: "ACME Plain", displayName: "Acme Plain" }] } };

function collectorWithJournal(interactive: Record<string, number>): { collector: CatalogueCollector; clock: { ms: number }; done(): void } {
  const clock = { ms: 1_000 };
  const directory = mkdtempSync(join(tmpdir(), "extynt-user-assisted-"));
  writeFileSync(join(directory, "catalogue-probe-journal.json"), JSON.stringify({ schemaVersion: 1, cleanup: false, hosts: { "After Effects:26.2.1:macOS": { attempts: {}, failed: {}, interactive, instanceReads: {} } } }));
  const store = { probedKeys: () => new Set<string>(), writeProbe: () => ({ written: [], failed: [] }), writeInstance: () => ({ written: false as const, code: "test" }) };
  const collector = new CatalogueCollector({ directory, now: () => clock.ms, store, log: () => undefined, enabled: true });
  collector.onCensus(census);
  return { collector, clock, done: () => rmSync(directory, { recursive: true, force: true }) };
}

test("an effect that held After Effects on a window is user assisted to the agent but still never probed", () => {
  const { collector, done } = collectorWithJournal({ "ACME Window": 500 });
  try {
    assert.deepEqual(collector.userAssistedNames(), ["ACME Window"]);
    assert.equal(collector.progress().deferred, 2, "the observed window and the curated dialog effect both wait for the user");
    const inventory = makeInventory({ application: "After Effects", version: "26.2.1", buildNumber: "2", platform: "macOS", architecture: "arm64" }, census.result.installedEffects.map((effect) => ({ matchName: effect.matchName, displayName: effect.displayName ?? effect.matchName, available: true, evidence: [] })));
    const evidence = catalogueEvidence({ catalogue: collector, collection: { catalogueEvidence: () => ({ effects: {} }) } }, makeHostProfile(inventory));
    assert.deepEqual(evidence.userAssisted, ["ACME Window"]);
    const profile = applyEffectControlEvidence(makeHostProfile(inventory), evidence);
    const reasons: Record<string, string | undefined> = Object.fromEntries(profile.entries.filter((entry) => ["ACME Plain", "ACME Window", "ADBE Apply Color LUT2"].includes(entry.matchName ?? "")).map((entry): [string, string | undefined] => [entry.matchName ?? "", entry.userAssisted?.reason]));
    assert.deepEqual(reasons, { "ACME Plain": undefined, "ACME Window": "observed-interactive", "ADBE Apply Color LUT2": "opens-dialog" });
  } finally { done(); }
});

test("with nothing observed the evidence carries no user assisted list", () => {
  const { collector, done } = collectorWithJournal({});
  try {
    assert.deepEqual(collector.userAssistedNames(), []);
    assert.equal(catalogueEvidence({ catalogue: collector, collection: { catalogueEvidence: () => ({ effects: {} }) } }, makeHostProfile(makeInventory({ application: "After Effects", version: "26.2.1", buildNumber: "2", platform: "macOS", architecture: "arm64" }, []))).userAssisted, undefined);
  } finally { done(); }
});

function effectLayer(matchName: string, index: number): LayerSnapshot {
  const effect: PropertySnapshot = { path: `ADBE Effect Parade/${matchName}`, matchName, displayName: matchName, kind: "effect", valueType: "unknown", value: null, canSetValue: false };
  const parade: PropertySnapshot = { path: "ADBE Effect Parade", matchName: "ADBE Effect Parade", displayName: "Effects", kind: "group", valueType: "unknown", value: null, canSetValue: false, children: [effect] };
  const base = normalizeProbeSnapshot(mutableSnapshot("user-assisted"), "2026-10-01T12:00:00Z").compositions.at(0)?.layers?.at(0);
  if (!base) throw new Error("the sidecar fixture has no layer");
  return { ...base, id: `layer-${index}`, name: matchName, index, properties: [parade] };
}

function projectWith(matchNames: string[]): ProjectSnapshot {
  const snapshot = normalizeProbeSnapshot(mutableSnapshot("user-assisted"), "2026-10-01T12:00:00Z");
  const layers = matchNames.map((matchName, index) => effectLayer(matchName, index + 1));
  return { ...snapshot, fingerprint: `fp-${matchNames.join("|")}`, compositions: snapshot.compositions.map((composition) => ({ ...composition, id: "comp-1", layers })) };
}

test("a dialog effect and an observed-interactive effect are read from a project instance, never probed or added", () => {
  const { collector, clock, done } = collectorWithJournal({ "ACME Window": 500 });
  try {
    collector.observeSnapshot(projectWith(["ADBE Apply Color LUT2", "ACME Window"]));
    const first = collector.nextInstanceRead(true, "panel-1");
    assert.ok(first && first.kind === "catalogue_page" && first.hostFunction === "aeCatalogueReadInstance");
    assert.equal(first.hostRequest.matchName, "ADBE Apply Color LUT2");
    collector.abandon(first.ticket, "test");
    clock.ms += 3_600_000;
    const second = collector.nextInstanceRead(true, "panel-1");
    assert.equal(second?.hostRequest.matchName, "ACME Window");
    assert.equal(collector.nextInstanceRead(true, "panel-1"), undefined, "an outstanding read blocks the next");
  } finally { done(); }
});

test("a dialog effect absent from the project is never issued as a probe page", () => {
  const { collector, done } = collectorWithJournal({});
  try {
    collector.observeSnapshot(projectWith(["ACME Plain"]));
    assert.equal(collector.nextInstanceRead(true, "panel-1"), undefined);
    const issued: string[] = [];
    for (let turn = 0; turn < 5; turn += 1) {
      const item = collector.nextItem(true, "panel-1");
      if (!item) break;
      issued.push(JSON.stringify(item));
      collector.abandon(item.ticket, "test");
    }
    assert.ok(issued.length > 0, "the plain effect is probed");
    assert.ok(issued.every((text) => !text.includes("ADBE Apply Color LUT2")), "the dialog effect is never in a probe page");
  } finally { done(); }
});

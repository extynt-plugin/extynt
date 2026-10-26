/** The live focus laid over the last project read: selection and the open composition are the panel's pulse, project content is the read's. */
import type { JsonObject } from "@extynt/decode";
import { fieldOf, flagOf, readJson, recordsOf, textOf } from "./http-json.js";
import { authorization, mutableSnapshot, sidecarFor, token } from "./sidecar-fixture.js";
import { overlayFocus } from "../src/focus-overlay.js";
import { FOCUS_FRESH_MS, type LiveFocus } from "../src/live-focus.js";
import { normalizeProbeSnapshot } from "../src/server-normalize.js";
import assert from "node:assert/strict";
import test from "node:test";
import { present } from "./present.js";

const NOW = Date.parse("2026-10-03T12:00:00.000Z");
const body = (over: JsonObject = {}) => ({ schemaVersion: "0.1", projectPath: null, projectName: "Fixture", epoch: null, revision: 7, activeCompositionId: "comp-1", activeCompositionName: "Main", selected: ["layer-1"], selectedLayers: [{ id: "layer-1", index: 1, name: "Original" }], ...over });
const live = (over: Partial<LiveFocus> = {}): LiveFocus => ({ projectPath: null, projectName: "Fixture", epoch: null, revision: 7, activeCompositionId: "comp-1", activeCompositionName: "Main", selected: ["layer-1"], selectedLayers: [], receivedAt: NOW, observedAt: NOW, ...over });

function twoLayers(requestId: string) {
  const base = mutableSnapshot(requestId), main = present(base.result.compositions[0]), layer = present(main.layers[0]);
  const compositions = [{ ...main, layers: [layer, { ...layer, id: "layer-2", index: 2, name: "Second", selected: false, type: "shape" }] }, { ...main, id: "comp-2", name: "Other", layers: [] }];
  return { ...base, result: { ...base.result, compositions } };
}
const normalized = (requestId = "overlay-1") => normalizeProbeSnapshot(twoLayers(requestId), "2026-10-03T12:00:00.000Z");
const selectedIds = (snapshot: ReturnType<typeof normalized>, compositionId = "comp-1") => present(snapshot.compositions.find((composition) => composition.id === compositionId)).layers.filter((layer) => layer.isSelected).map((layer) => layer.id);

test("the overlay moves the selection and the open composition, and never the fingerprint, revision or freshness", () => {
  const read = normalized(), laid = overlayFocus(read, live({ selected: ["layer-2"] }), NOW);
  assert.deepEqual(selectedIds(read), ["layer-1"]); assert.deepEqual(selectedIds(laid), ["layer-2"], "isSelected follows the focus");
  assert.deepEqual(laid.selection, { compositionId: "comp-1", layerIds: ["layer-2"] });
  assert.notEqual(laid.selectionFingerprint, read.selectionFingerprint, "another selection is another selection fingerprint");
  assert.equal(laid.fingerprint, read.fingerprint); assert.equal(laid.freshness.revision, read.freshness.revision); assert.deepEqual(laid.freshness, read.freshness);
  assert.equal(laid.revision, read.revision); assert.deepEqual(laid.hostStamp, read.hostStamp);
  assert.strictEqual(laid.compositions[1], read.compositions[1], "a composition whose flags did not change is shared, not copied");
  assert.equal(overlayFocus(read, live({ selected: ["layer-1"] }), NOW).selectionFingerprint, read.selectionFingerprint, "the same view gives the same selection fingerprint");
  const moved = overlayFocus(read, live({ activeCompositionId: "comp-2", selected: [] }), NOW);
  assert.equal(moved.activeCompositionId, "comp-2"); assert.deepEqual(selectedIds(moved), []); assert.equal(moved.fingerprint, read.fingerprint);
  const none = overlayFocus(read, live({ activeCompositionId: null, selected: [] }), NOW);
  assert.equal(none.activeCompositionId, null); assert.deepEqual(none.selection, { compositionId: null, layerIds: [] });
});

test("no overlay for a stale report, another project, a composition the read lacks, or a scoped read", () => {
  const read = normalized(), moved = { selected: ["layer-2"] };
  assert.strictEqual(overlayFocus(read, live({ ...moved, observedAt: NOW - FOCUS_FRESH_MS - 1, receivedAt: NOW - FOCUS_FRESH_MS - 1 }), NOW), read, "a stale report says nothing about AE now");
  assert.strictEqual(overlayFocus(read, live({ ...moved, projectName: "Other.aep", projectPath: "/p/Other.aep" }), NOW), read, "another project");
  assert.strictEqual(overlayFocus(read, live({ ...moved, activeCompositionId: "comp-9" }), NOW), read, "an open composition the read does not hold");
  const scoped = { ...read, coverage: { kind: "composition-metadata" as const, compositionId: "comp-1", properties: "unknown" as const, otherCompositions: "unknown" as const } };
  assert.strictEqual(overlayFocus(scoped, live(moved), NOW), scoped, "a scoped read says nothing about the rest, so it is left alone");
  assert.strictEqual(overlayFocus(read, null, NOW), read); assert.strictEqual(overlayFocus(read, undefined, NOW), read);
});

async function start(t: { after: (fn: () => void) => void }) {
  const clock = { ms: NOW };
  const sidecar = sidecarFor({ port: 0, token, panelSessionId: "panel-overlay", panelSnapshotWaitMs: 150, quietAgentLog: true, now: () => new Date(clock.ms) });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`, json = { ...authorization, "content-type": "application/json" };
  const post = <T>(path: string, value: T) => fetch(`${base}${path}`, { method: "POST", headers: json, body: JSON.stringify(value) });
  return { sidecar, base, clock, post, focus: async (over: JsonObject = {}) => readJson(await post("/v1/panel/focus", body(over))) };
}

test("the focus answer carries the selection fingerprint and the view the panel draws, from the overlaid read", async (t) => {
  const h = await start(t);
  const before = await readJson(await h.post("/v1/panel/focus", body()));
  assert.equal(flagOf(before, "ok"), true); assert.equal(fieldOf(before, "selectionFingerprint"), null, "nothing to draw it from before a read");
  assert.equal(fieldOf(before, "view"), null);
  const uploaded = await readJson(await h.post("/v1/snapshots", twoLayers("overlay-http")));
  const read = present(h.sidecar.normalizedLatest());
  assert.equal(textOf(uploaded, "fingerprint"), read.fingerprint);
  const answer = await h.focus({ selected: ["layer-1", "layer-2"], selectedLayers: [] });
  assert.equal(textOf(answer, "selectionFingerprint"), present(h.sidecar.normalizedLatest()).selectionFingerprint);
  assert.deepEqual(fieldOf(answer, "view"), { activeComposition: { id: "comp-1", name: "Main", width: 1920, height: 1080, layerCount: 2 }, selected: 2, selectedKinds: ["shape", "text"], selectedLayers: [], projectSaved: false });
  assert.notEqual(textOf(answer, "selectionFingerprint"), read.selectionFingerprint);
  const fingerprint = present(h.sidecar.normalizedLatest()).fingerprint;
  assert.equal(fingerprint, read.fingerprint, "the project fingerprint is the read's own");
  const other = await h.focus({ activeCompositionId: "comp-2", activeCompositionName: "Other", selected: [], selectedLayers: [] });
  assert.deepEqual(fieldOf(other, "view"), { activeComposition: { id: "comp-2", name: "Other", width: 1920, height: 1080, layerCount: 0 }, selected: 0, selectedKinds: [], selectedLayers: [], projectSaved: false });
  const unknown = await h.focus({ activeCompositionId: "comp-9", activeCompositionName: "Unread", selected: [], selectedLayers: [] });
  assert.equal(fieldOf(unknown, "view"), null, "a composition the read lacks is not drawn from it");
  assert.equal(fieldOf(unknown, "selectionFingerprint"), null);
});

test("the overlaid read is what tools and the snapshot answer see, and a stale report falls back to the read's own selection", async (t) => {
  const h = await start(t);
  await h.post("/v1/snapshots", twoLayers("overlay-tools"));
  await h.focus({ selected: ["layer-2"], selectedLayers: [] });
  assert.deepEqual(selectedIds(present(h.sidecar.normalizedLatest())), ["layer-2"]);
  h.clock.ms += FOCUS_FRESH_MS + 1;
  assert.deepEqual(selectedIds(present(h.sidecar.normalizedLatest())), ["layer-1"], "a report that stopped coming is not trusted");
  h.clock.ms = NOW; await h.focus({ selected: ["layer-2"], selectedLayers: [] });
  const again = await readJson(await h.post("/v1/snapshots", twoLayers("overlay-again")));
  assert.equal(textOf(again, "selectionFingerprint"), present(h.sidecar.normalizedLatest()).selectionFingerprint, "a new read is answered with the fingerprint suggestions are matched against");
});

test("the view names the selected layers for the context chip: at most eight, each name bounded", async (t) => {
  const h = await start(t);
  await h.post("/v1/snapshots", twoLayers("overlay-names"));
  const named = Array.from({ length: 12 }, (_, index) => ({ id: `layer-${index}`, index: index + 1, name: index === 0 ? "N".repeat(300) : `Layer ${index}` }));
  const answer = await h.focus({ selected: named.map((layer) => layer.id), selectedLayers: named });
  const layers = recordsOf(answer, "view.selectedLayers");
  assert.equal(layers.length, 8);
  assert.deepEqual(layers.map((layer) => textOf(layer, "id")), named.slice(0, 8).map((layer) => layer.id));
  assert.equal(textOf(present(layers[0]), "name").length, 128);
  assert.equal(fieldOf(fieldOf(answer, "view"), "selected"), 12, "the count is the whole selection");
});

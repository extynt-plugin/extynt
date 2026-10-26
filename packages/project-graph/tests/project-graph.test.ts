/** Queries, effect and expression extraction, property nesting and fingerprint rules over the representative snapshot. */
import assert from "node:assert/strict";
import test from "node:test";
import type { LayerSnapshot } from "../src/index.js";
import {
  createSnapshot,
  extractEffects,
  extractExpressions,
  findEffect,
  findProperty,
  getActiveComposition,
  getSelectedLayerEffects,
  getSelectedLayerExpressions,
  getSelectedLayers,
  graphFingerprint,
  canonicalSnapshot,
  snapshotRevision,
  isProjectSnapshot,
  queryLayers,
  queryEffects,
  queryExpressions,
  representativeSnapshot,
  resolveComposition,
  resolveLayer,
  layersInScope,
  selectionFingerprint,
  summarizeSnapshot,
  nestPropertyPaths,
} from "../src/index.js";
import { compositionAt, layerAt, required } from "./snapshot-parts.js";

test("representative snapshot is a valid, deterministic v0.1 graph", () => {
  assert.equal(isProjectSnapshot(representativeSnapshot), true);
  assert.equal(representativeSnapshot.schemaVersion, "0.1");
  assert.equal(representativeSnapshot.host.version, "26.2.1");
  assert.equal(representativeSnapshot.host.buildNumber, "2");
  assert.equal(representativeSnapshot.host.architecture, "arm64");
  assert.equal(representativeSnapshot.fingerprint, graphFingerprint(representativeSnapshot));
  assert.equal(representativeSnapshot.fingerprint, "fp3-98cc35835eeec0c4baa7c97a6d41e090", "a pinned value: the canonical encoding must not drift by accident");
  assert.equal(representativeSnapshot.selectionFingerprint, selectionFingerprint(representativeSnapshot));
});

test("fingerprint excludes volatile capture context but detects structural reorder", () => {
  const moved = { ...representativeSnapshot, capturedAt: "2099-01-01T00:00:00.000Z", currentTime: 7, selection: { compositionId: "comp-main", layerIds: [] } };
  assert.equal(graphFingerprint(moved), representativeSnapshot.fingerprint);
  assert.equal(snapshotRevision(moved), representativeSnapshot.fingerprint);
  assert.equal("capturedAt" in canonicalSnapshot(moved), false);
  assert.equal(graphFingerprint({ ...moved, selection: { compositionId: "comp-square", layerIds: ["layer-social-title"] } }), representativeSnapshot.fingerprint);
  const reordered = structuredClone(representativeSnapshot);
  compositionAt(reordered).layers.reverse();
  assert.notEqual(graphFingerprint(reordered), representativeSnapshot.fingerprint);
});

test("active and selected context resolve to persistent IDs", () => {
  assert.equal(getActiveComposition(representativeSnapshot)?.id, "comp-main");
  assert.deepEqual(getSelectedLayers(representativeSnapshot).map((layer) => layer.id), ["layer-title"]);
  assert.deepEqual(queryLayers(representativeSnapshot).map((layer) => [layer.id, layer.index]), [["layer-title", 1], ["layer-footage", 2], ["layer-social-title", 1]]);
  assert.deepEqual(queryLayers(representativeSnapshot, { type: "text" }).map((layer) => layer.id), ["layer-title", "layer-social-title"]);
});

test("graph fingerprint ignores the active composition and revision, while the selection fingerprint tracks them", () => {
  const clicked = createSnapshot({
    ...representativeSnapshot,
    capturedAt: "2026-09-11T15:00:05.000Z",
    revision: "3:comp-square",
    activeCompositionId: "comp-square",
    currentTime: 0,
    selection: { compositionId: "comp-square", layerIds: [] },
    freshness: { revision: "3:comp-square", capturedAt: "2026-09-11T15:00:05.000Z", receivedAt: null },
  });
  assert.equal(graphFingerprint(clicked), representativeSnapshot.fingerprint, "clicking another composition is not a project edit");
  assert.equal(clicked.fingerprint, representativeSnapshot.fingerprint);
  assert.notEqual(selectionFingerprint(clicked), representativeSnapshot.selectionFingerprint);
  const activeOnly = structuredClone(representativeSnapshot);
  activeOnly.activeCompositionId = "comp-square";
  assert.equal(graphFingerprint(activeOnly), representativeSnapshot.fingerprint, "the active composition is volatile UI selection");
  const revisionOnly = structuredClone(representativeSnapshot);
  revisionOnly.revision = "3:comp-square";
  assert.equal(graphFingerprint(revisionOnly), representativeSnapshot.fingerprint, "the adapter revision token is an observation token");
  const stampOnly = { ...structuredClone(representativeSnapshot), hostStamp: { epoch: 1, revision: 41 } };
  assert.equal(graphFingerprint(stampOnly), graphFingerprint({ ...stampOnly, hostStamp: { epoch: 1, revision: 40 } }), "AE's change counter is an observation token");
  const selectionOnly = structuredClone(representativeSnapshot);
  selectionOnly.selection = { compositionId: "comp-main", layerIds: ["layer-footage"] };
  assert.equal(graphFingerprint(selectionOnly), representativeSnapshot.fingerprint);
  assert.notEqual(selectionFingerprint(selectionOnly), selectionFingerprint(representativeSnapshot));
});

test("graph fingerprint still detects structural edits after excluding UI selection", () => {
  const relabeled = structuredClone(representativeSnapshot);
  layerAt(relabeled).label = 12;
  assert.notEqual(graphFingerprint(relabeled), representativeSnapshot.fingerprint);
  const renamed = structuredClone(representativeSnapshot);
  layerAt(renamed).name = "TITLE — Winter";
  assert.notEqual(graphFingerprint(renamed), representativeSnapshot.fingerprint);
  const retimed = structuredClone(representativeSnapshot);
  compositionAt(retimed).duration = 24;
  assert.notEqual(graphFingerprint(retimed), representativeSnapshot.fingerprint);
  const reordered = structuredClone(representativeSnapshot);
  compositionAt(reordered).layers.reverse();
  assert.notEqual(graphFingerprint(reordered), representativeSnapshot.fingerprint);
});

test("limit-bounded layer queries keep the top of the AE stack when ids are multi-digit", () => {
  const stackOrder = ["12", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "1"];
  const layers: LayerSnapshot[] = stackOrder.map((id, position) => ({
    id, index: position + 1, name: `L${id}`, type: "av", enabled: true, shy: false, solo: false, locked: false,
    startTime: 0, inPoint: 0, outPoint: 5, stretch: 100, parentId: null, matteLayerId: null, matteType: "none",
    isSelected: id === "12" || id === "1", sourceId: null, properties: [],
  }));
  const snapshot = createSnapshot({
    capturedAt: "2026-09-11T15:00:00.000Z", revision: "rev-1",
    host: { application: "After Effects", version: "26.2.1", buildNumber: "2", platform: "macOS", architecture: "arm64" },
    project: { name: "P", filePath: null },
    activeCompositionId: "comp-1", currentTime: 0,
    selection: { compositionId: "comp-1", layerIds: ["12", "1"] },
    compositions: [{
      id: "comp-1", name: "Main", width: 1920, height: 1080, pixelAspect: 1, duration: 5, frameRate: 24,
      workAreaStart: 0, workAreaDuration: 5, layers,
    }],
  });
  assert.deepEqual(queryLayers(snapshot).map((layer) => layer.index), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(queryLayers(snapshot).slice(0, 3).map((layer) => layer.index), [1, 2, 3]);
  assert.deepEqual(getSelectedLayers(snapshot).map((layer) => layer.index), [1, 12]);
});

test("resolution distinguishes missing, found, and ambiguous names", () => {
  assert.equal(resolveLayer(representativeSnapshot, { compositionId: "comp-main", id: "layer-title" }).status, "found");
  assert.equal(resolveLayer(representativeSnapshot, { id: "missing" }).status, "missing");
  const open = resolveLayer(representativeSnapshot, { name: "TITLE — Summer" });
  assert.equal(open.status, "found", "the open composition holds the title, so it wins");
  assert.equal(resolveComposition(representativeSnapshot, { name: "Main" }).status, "found");
});

test("a name shared by several compositions resolves to the open composition's layer", () => {
  const named = { name: "TITLE — Summer" };
  const found = resolveLayer(representativeSnapshot, named);
  assert.equal(found.status, "found");
  assert.equal(found.status === "found" ? found.value.id : null, "layer-title");
  const socialOpen = { ...representativeSnapshot, activeCompositionId: "comp-square" };
  const social = resolveLayer(socialOpen, named);
  assert.equal(social.status === "found" ? social.value.id : null, "layer-social-title");
});

test("a name shared by several compositions stays ambiguous when no composition is open or the open one is not among them", () => {
  const named = { name: "TITLE — Summer" };
  const noneOpen = resolveLayer({ ...representativeSnapshot, activeCompositionId: null }, named);
  assert.equal(noneOpen.status, "ambiguous");
  assert.equal(noneOpen.value.length, 2);
  const otherOpen = resolveLayer({ ...representativeSnapshot, activeCompositionId: "comp-elsewhere" }, named);
  assert.equal(otherOpen.status, "ambiguous");
});

test("a name the open composition lacks resolves to the one match elsewhere, and an explicit composition is never overridden", () => {
  const plate = resolveLayer({ ...representativeSnapshot, activeCompositionId: "comp-square" }, { name: "Plate" });
  assert.equal(plate.status === "found" ? plate.value.id : null, "layer-footage");
  const pinned = resolveLayer(representativeSnapshot, { name: "TITLE — Summer", compositionId: "comp-square" });
  assert.equal(pinned.status === "found" ? pinned.value.id : null, "layer-social-title");
});

test("layersInScope keeps stack order and reports which scope answered", () => {
  const open = layersInScope(representativeSnapshot, (layer) => layer.name === "TITLE — Summer");
  assert.equal(open.scope, "open-composition");
  assert.deepEqual(open.layers.map((layer) => layer.id), ["layer-title"]);
  const elsewhere = layersInScope({ ...representativeSnapshot, activeCompositionId: null }, (layer) => layer.name === "TITLE — Summer");
  assert.equal(elsewhere.scope, "project");
  assert.deepEqual(elsewhere.layers.map((layer) => layer.id), ["layer-title", "layer-social-title"]);
});

test("property lookup uses stable matchName paths, including nested groups", () => {
  const layer = resolveLayer(representativeSnapshot, { id: "layer-title" });
  assert.equal(layer.status, "found");
  if (layer.status !== "found") return;
  assert.equal(findProperty(layer.value, { path: "ADBE Transform Group/ADBE Position" })?.matchName, "ADBE Position");
  assert.equal(findProperty(layer.value, { matchName: "ADBE Text Document" })?.value, "Summer");
});

test("effect extraction normalizes the observed generic effect-parade shape", () => {
  const layer = layerAt(representativeSnapshot);
  const effects = extractEffects(layer);
  assert.equal(effects.length, 1);
  const effect = required(effects[0], "the blur effect");
  assert.equal(effect.path, "ADBE Effect Parade/ADBE Gaussian Blur 2");
  assert.equal(effect.matchName, "ADBE Gaussian Blur 2");
  assert.equal(effect.displayName, "Gaussian Blur");
  assert.equal(effect.enabled, true);
  assert.deepEqual(effect.properties.map((property) => property.matchName), ["ADBE Gaussian Blur 2-0001"]);
  assert.deepEqual(effect.expressions.map((expression) => [expression.path, expression.enabled]), [[
    "ADBE Effect Parade/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001",
    false,
  ]]);
  assert.equal(findEffect(layer, { matchName: "ADBE Gaussian Blur 2" })?.displayName, "Gaussian Blur");
});

test("a flat, path-carrying property list becomes the tree effect extraction needs", () => {
  const flat: LayerSnapshot["properties"] = [
    { path: "ADBE Transform Group", matchName: "ADBE Transform Group", displayName: "Transform", kind: "group", valueType: "unknown", value: null, canSetValue: false, expression: null, expressionEnabled: false },
    { path: "ADBE Transform Group/ADBE Position", matchName: "ADBE Position", displayName: "Position", kind: "property", valueType: "vector", value: [1, 2], canSetValue: true, expression: null, expressionEnabled: false },
    { path: "ADBE Effect Parade", matchName: "ADBE Effect Parade", displayName: "Effects", kind: "group", valueType: "unknown", value: null, canSetValue: false, expression: null, expressionEnabled: false },
    { path: "ADBE Effect Parade/ADBE Gaussian Blur 2", matchName: "ADBE Gaussian Blur 2", displayName: "Gaussian Blur", kind: "effect", valueType: "unknown", value: null, canSetValue: false, expression: null, expressionEnabled: false },
    { path: "ADBE Effect Parade/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001", matchName: "ADBE Gaussian Blur 2-0001", displayName: "Blurriness", kind: "property", valueType: "number", value: 12, canSetValue: true, expression: null, expressionEnabled: false },
  ];
  const tree = nestPropertyPaths(flat);
  assert.deepEqual(tree.map((property) => property.path), ["ADBE Transform Group", "ADBE Effect Parade"], "only roots stay at the top");
  const parade = required(tree.find((property) => property.path === "ADBE Effect Parade"), "the effect parade");
  assert.deepEqual(parade.children?.map((property) => property.path), ["ADBE Effect Parade/ADBE Gaussian Blur 2"]);
  assert.deepEqual(parade.children?.[0]?.children?.map((property) => property.path), ["ADBE Effect Parade/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001"]);
  const layer: LayerSnapshot = { ...layerAt(representativeSnapshot), properties: tree };
  assert.deepEqual(extractEffects(layer).map((effect) => effect.matchName), ["ADBE Gaussian Blur 2"]);
  const nested = layerAt(representativeSnapshot).properties;
  assert.deepEqual(nestPropertyPaths(nested), nested, "already-nested input is returned as it was");
});

test("expression extraction and selected queries retain project identity", () => {
  const layer = resolveLayer(representativeSnapshot, { id: "layer-title" });
  assert.equal(layer.status, "found");
  if (layer.status !== "found") return;
  assert.deepEqual(extractExpressions(layer.value).map((expression) => [expression.matchName, expression.enabled]), [
    ["ADBE Gaussian Blur 2-0001", false],
    ["ADBE Position", true],
  ]);
  assert.deepEqual(getSelectedLayerEffects(representativeSnapshot).map((match) => [match.compositionId, match.layerId, match.effect.matchName]), [
    ["comp-main", "layer-title", "ADBE Gaussian Blur 2"],
  ]);
  assert.deepEqual(getSelectedLayerExpressions(representativeSnapshot).map((match) => match.expression.path), [
    "ADBE Effect Parade/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001",
    "ADBE Transform Group/ADBE Position",
  ]);
  assert.equal(queryEffects(representativeSnapshot, { name: "Gaussian Blur" })[0]?.layerId, "layer-title");
  assert.equal(queryExpressions(representativeSnapshot, { matchName: "ADBE Position" })[0]?.layerId, "layer-title");
});

test("explicit effect kind remains compatible with generic property trees", () => {
  const layer = structuredClone(layerAt(representativeSnapshot));
  const explicitEffect = {
    path: "ADBE Effect Parade/ADBE Tint",
    matchName: "ADBE Tint",
    displayName: "Tint",
    kind: "effect" as const,
    valueType: "unknown" as const,
    value: null,
    canSetValue: false,
    children: [],
  };
  assert.deepEqual(extractEffects({ ...layer, properties: [...layer.properties, explicitEffect] }).map((effect) => effect.matchName), [
    "ADBE Gaussian Blur 2",
    "ADBE Tint",
  ]);
});

test("summary gives a compact structural answer", () => {
  assert.deepEqual(summarizeSnapshot(representativeSnapshot), {
    compositionCount: 2,
    layerCount: 3,
    selectedLayerCount: 1,
    layersByType: { text: 2, av: 1 },
  });
});

test("fingerprint ignores time-sampled values of animated properties but detects keyframe count changes", () => {
  const animated = structuredClone(representativeSnapshot);
  const opacity = { path: "ADBE Transform Group/ADBE Opacity", matchName: "ADBE Opacity", displayName: "Opacity", kind: "property" as const, valueType: "number" as const, value: 0, canSetValue: true, keyframeCount: 2 };
  layerAt(animated, 1).properties.push(opacity);
  const baseline = graphFingerprint(animated);
  opacity.value = 73;
  assert.equal(graphFingerprint(animated), baseline, "scrubbing the timeline is not an edit");
  opacity.keyframeCount = 3;
  assert.notEqual(graphFingerprint(animated), baseline);
  const staticValue = structuredClone(animated);
  const staticOpacity = required(layerAt(staticValue, 1).properties.at(-1), "the opacity property");
  delete staticOpacity.keyframeCount;
  const staticBaseline = graphFingerprint(staticValue);
  staticOpacity.value = 12;
  assert.notEqual(graphFingerprint(staticValue), staticBaseline);
});

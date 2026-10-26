/** Tests snapshot comparison: tolerances, headlines and failures. */
import assert from "node:assert/strict";
import test from "node:test";
import { compareSnapshots } from "../lib/compare.ts";
import { valuesEqual } from "../lib/compare-core.ts";
import { formatCompare } from "../lib/compare-report.ts";
import { firstOrderDivergence } from "../lib/compare-props.ts";
import { entry } from "./fixtures.ts";
import { compositionOf, draftObjectOf, draftLayer, extraComposition, layerOf, listIn, objectIn, present, propertyOf, rowsIn, snapshotPair } from "./snapshot-draft.ts";

const POSITION = "ADBE Transform Group/ADBE Position";
const OPACITY = "ADBE Transform Group/ADBE Opacity";

test("identical snapshots pass with both id headlines matching", () => {
  const { probe, native } = snapshotPair();
  const report = compareSnapshots(native, probe);
  assert.equal(report.verdict.pass, true);
  assert.equal(report.headlines.itemIds.match, true);
  assert.equal(report.headlines.layerIds.match, true);
  assert.deepEqual([report.compared.items, report.compared.layers, report.compared.properties], [3, 2, 6]);
  assert.match(formatCompare(report), /layer ids match:\s+YES/);
  assert.match(formatCompare(report), /RESULT: PASS/);
});

test("numbers compare within 1e-6 absolute or relative; arrays elementwise", () => {
  assert.equal(valuesEqual(1, 1 + 5e-7), true);
  assert.equal(valuesEqual(1e9, 1e9 + 500), true);
  assert.equal(valuesEqual(1, 1.001), false);
  assert.equal(valuesEqual([1, 2, 3], [1, 2, 3.0000001]), true);
  assert.equal(valuesEqual([1, 2], [1, 2, 3]), false);
  assert.equal(valuesEqual(undefined, null), true);
  assert.equal(valuesEqual("a", "b"), false);
});

test("a layer field difference is reported with both values and fails", () => {
  const { probe, native } = snapshotPair();
  layerOf(native, 1).name = "Renamed";
  layerOf(native, 0).threeD = true;
  const report = compareSnapshots(native, probe);
  assert.equal(report.verdict.pass, false);
  const name = present(report.diffs["layer.name"]);
  assert.equal(name.count, 1);
  assert.deepEqual(present(name.examples[0]).probe, "Layer 12");
  assert.deepEqual(present(name.examples[0]).native, "Renamed");
  assert.equal(present(report.diffs["layer.threeD"]).count, 1);
  assert.match(formatCompare(report), /RESULT: FAIL/);
});

test("item, source and composition field differences are grouped by category", () => {
  const { probe, native } = snapshotPair();
  present(rowsIn(native, "items")[0]).name = "Other";
  present(rowsIn(native, "sources")[0]).width = 1280;
  compositionOf(native).frameRate = 30;
  compositionOf(native).backgroundColor = [1, 0, 0];
  const { diffs } = compareSnapshots(native, probe);
  assert.deepEqual(Object.keys(diffs).sort(), ["composition.backgroundColor", "composition.frameRate", "item.name", "source.width"]);
});

test("switches differ per key but per-character-3d and one-sided audioEnabled are ignored", () => {
  const { probe, native } = snapshotPair();
  objectIn(layerOf(probe, 0), "switches")["per-character-3d"] = true;
  layerOf(probe, 0).audioEnabled = true;
  objectIn(layerOf(native, 1), "switches")["blend-mode"] = "ADD";
  const report = compareSnapshots(native, probe);
  assert.deepEqual(Object.keys(report.diffs), ["layer.switches.blend-mode"]);
  layerOf(native, 0).audioEnabled = false;
  assert.equal(present(compareSnapshots(native, probe).diffs["layer.audioEnabled"]).count, 1);
});

test("missing items, compositions, layers and paths are listed per side", () => {
  const { probe, native } = snapshotPair();
  listIn(native, "items").pop();
  listIn(probe, "items").push({ id: "99", name: "Probe only", type: "footage", parentFolderId: "0", compositionId: null, sourceId: "99" });
  listIn(compositionOf(native), "layers").pop();
  listIn(layerOf(native, 0), "propertyPaths").pop();
  listIn(layerOf(probe, 0), "propertyPaths").push(draftObjectOf(entry("ADBE Transform Group/ADBE Scale")));
  listIn(native, "compositions").push(extraComposition("8", "Native only", []));
  const { missing, headlines, verdict } = compareSnapshots(native, probe);
  assert.equal(present(missing["item:missing-in-native"]).count, 2);
  assert.equal(present(missing["layer:missing-in-native"]).count, 1);
  assert.equal(present(missing["path:missing-in-native"]).count, 2);
  assert.equal(present(missing["composition:missing-in-probe"]).count, 1);
  assert.equal(headlines.itemIds.match, false);
  assert.equal(headlines.layerIds.match, false);
  assert.equal(verdict.pass, false);
});

test("native-only paths in a probe-truncated layer are tallied, not diffs", () => {
  const { probe, native } = snapshotPair();
  listIn(layerOf(probe, 0), "propertyPaths").pop();
  layerOf(probe, 0).propertyPathsTruncated = true;
  const report = compareSnapshots(native, probe);
  assert.equal(report.verdict.pass, true);
  assert.equal(report.exempt["path: native-only (probe truncated)"], 1);
  assert.equal(report.missing["path:missing-in-probe"], undefined);
});

test("native-only layers and compositions are exempt when the probe's paging says it did not read them", () => {
  const { probe, native } = snapshotPair();
  listIn(native, "compositions").push(extraComposition("8", "Unread", [draftLayer("30", 1)]));
  probe.compositionPages = { unread: ["8"], partial: [], capped: false };
  assert.equal(compareSnapshots(native, probe).verdict.pass, true);
  probe.compositionPages = { unread: [], partial: [], capped: false };
  assert.equal(compareSnapshots(native, probe).verdict.pass, false);
});

test("an unsupported native value is skipped and tallied by type, never a diff", () => {
  const { probe, native } = snapshotPair();
  propertyOf(layerOf(probe, 0), POSITION).value = { kind: "shape" };
  propertyOf(layerOf(native, 0), POSITION).value = { unsupported: "shape-path" };
  propertyOf(layerOf(native, 1), POSITION).value = { unsupported: "shape-path" };
  const report = compareSnapshots(native, probe);
  assert.equal(report.verdict.pass, true);
  assert.equal(report.skipped["shape-path"], 2);
});

test("property field differences cover value, expression and the absent-means-default fields", () => {
  const { probe, native } = snapshotPair();
  const first = layerOf(native, 0), second = layerOf(native, 1);
  propertyOf(first, POSITION).value = [960, 541];
  propertyOf(second, POSITION).expression = "wiggle(1,1)";
  propertyOf(first, OPACITY).keyframeCount = 3;
  propertyOf(second, OPACITY).hidden = true;
  const { diffs, knownProbeDefect } = compareSnapshots(native, probe);
  assert.deepEqual(Object.keys(diffs).sort(), ["property.expression", "property.keyframeCount", "property.value"]);
  assert.deepEqual(Object.keys(knownProbeDefect.categories), ["property.hidden"]);
  propertyOf(layerOf(probe, 0), OPACITY).keyframeCount = 3;
  propertyOf(layerOf(probe, 0), OPACITY).keyDigest = "abc";
  assert.equal(compareSnapshots(native, probe).diffs["property.keyframeCount"], undefined);
});

test("absent animatable equals true and absent hidden equals false", () => {
  const { probe, native } = snapshotPair();
  propertyOf(layerOf(probe, 0), POSITION).animatable = true;
  propertyOf(layerOf(native, 0), POSITION).hidden = false;
  assert.equal(compareSnapshots(native, probe).verdict.pass, true);
  propertyOf(layerOf(native, 0), POSITION).animatable = false;
  assert.equal(present(compareSnapshots(native, probe).diffs["property.animatable"]).count, 1);
});

test("path order divergence is informational and does not fail", () => {
  const { probe, native } = snapshotPair();
  listIn(layerOf(native, 0), "propertyPaths").reverse();
  const report = compareSnapshots(native, probe);
  assert.equal(report.verdict.pass, true);
  assert.equal(report.order.layersDiverging, 1);
  assert.equal(present(report.order.examples[0]).position, 0);
  assert.deepEqual(firstOrderDivergence(["a", "b"], ["a", "c", "d"]), { position: 1, probe: "b", native: "c" });
  assert.equal(firstOrderDivergence(["a"], ["a", "b"]), null);
});

test("a comparison that matched no layers cannot pass", () => {
  const { probe, native } = snapshotPair();
  probe.compositions = [];
  native.compositions = [];
  const report = compareSnapshots(native, probe);
  assert.equal(report.verdict.pass, false);
  assert.match(report.verdict.reasons.join(), /no layers/);
});

test("project-level differences are informational", () => {
  const { probe, native } = snapshotPair();
  objectIn(native, "project").filePath = "Macintosh HD:Test.aep";
  const report = compareSnapshots(native, probe);
  assert.equal(report.verdict.pass, true);
  assert.equal(present(report.info["project.filePath"]).count, 1);
});

test("examples are capped by maxExamples while counts stay complete", () => {
  const { probe, native } = snapshotPair();
  for (const layer of [layerOf(native, 0), layerOf(native, 1)]) layer.name = `x${String(layer.id)}`;
  const report = compareSnapshots(native, probe, { maxExamples: 1 });
  assert.equal(present(report.diffs["layer.name"]).count, 2);
  assert.equal(present(report.diffs["layer.name"]).examples.length, 1);
});

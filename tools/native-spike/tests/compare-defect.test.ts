/** Tests how known probe gaps are listed apart from real differences. */
import assert from "node:assert/strict";
import test from "node:test";
import { objectAt, rowsAt, textAt } from "../lib/json-access.ts";
import { compareSnapshots } from "../lib/compare.ts";
import { formatCompare } from "../lib/compare-report.ts";
import { probeEnvelope } from "./fixtures.ts";
import { draftLayer, extraComposition, layerOf, listIn, parseObject, present, propertyOf, snapshotPair } from "./snapshot-draft.ts";

const OPACITY = "ADBE Transform Group/ADBE Opacity";
const POSITION = "ADBE Transform Group/ADBE Position";
const TITLE = "known probe defect: isHidden unavailable on this AE";

test("hidden and canSetValue differences alone still PASS and are listed under the known probe defect heading", () => {
  const { probe, native } = snapshotPair();
  propertyOf(layerOf(native, 0), OPACITY).hidden = true;
  propertyOf(layerOf(native, 1), OPACITY).hidden = true;
  propertyOf(layerOf(native, 0), POSITION).canSetValue = false;
  const report = compareSnapshots(native, probe, { maxExamples: 1 });
  assert.equal(report.verdict.pass, true);
  assert.deepEqual(report.verdict.reasons, []);
  assert.deepEqual(report.diffs, {});
  assert.equal(present(report.knownProbeDefect.categories["property.hidden"]).count, 2);
  assert.equal(present(report.knownProbeDefect.categories["property.hidden"]).examples.length, 1);
  assert.equal(present(report.knownProbeDefect.categories["property.canSetValue"]).count, 1);
  const text = formatCompare(report);
  assert.match(text, new RegExp(TITLE));
  assert.match(text, /property\.hidden: 2/);
  assert.match(text, /property\.canSetValue: 1/);
  assert.match(text, /comp 5 \/ layer 11 "Layer 11" \/ ADBE Transform Group\/ADBE Opacity: probe=false native=true/);
  assert.match(text, /RESULT: PASS\nknown probe defect differences \(not counted\): 3/);
});

test("a real difference next to a hidden one fails and the reasons name only the real one", () => {
  const { probe, native } = snapshotPair();
  propertyOf(layerOf(native, 0), OPACITY).hidden = true;
  layerOf(native, 1).name = "Renamed";
  const report = compareSnapshots(native, probe);
  assert.equal(report.verdict.pass, false);
  assert.deepEqual(report.verdict.reasons, ["1 field differences"]);
  assert.equal(present(report.knownProbeDefect.categories["property.hidden"]).count, 1);
  const text = formatCompare(report);
  assert.match(text, /RESULT: FAIL \(1 field differences\)\nknown probe defect differences \(not counted\): 1/);
  assert.equal(present(report.diffs["layer.name"]).count, 1);
});

test("the JSON report carries the defect groups under knownProbeDefect with a title and empty by default", () => {
  const { probe, native } = snapshotPair();
  assert.deepEqual(compareSnapshots(native, probe).knownProbeDefect, { title: TITLE, categories: {} });
  assert.doesNotMatch(formatCompare(compareSnapshots(native, probe)), /known probe defect/);
  propertyOf(layerOf(native, 0), OPACITY).hidden = true;
  const defect = objectAt(parseObject(JSON.stringify(compareSnapshots(native, probe))), "knownProbeDefect");
  assert.equal(textAt(defect, "title"), TITLE);
  assert.equal(present(rowsAt(objectAt(objectAt(defect, "categories"), "property.hidden"), "examples")[0]).native, true);
});

test("other property fields keep failing", () => {
  const { probe, native } = snapshotPair();
  propertyOf(layerOf(native, 0), OPACITY).enabled = false;
  propertyOf(layerOf(probe, 0), OPACITY).enabled = true;
  assert.equal(present(compareSnapshots(native, probe).diffs["property.enabled"]).count, 1);
});

test("a probe envelope with unread compositions keeps them exempt and names them in the note", () => {
  const { probe, native } = snapshotPair();
  probe.compositionPages = { unread: ["8", "9"], oversized: ["10"], partial: [], capped: false };
  for (const id of ["8", "9", "10"]) listIn(native, "compositions").push(extraComposition(id, `Comp ${id}`, [draftLayer(`${id}0`, 1)]));
  const report = compareSnapshots(native, objectAt(probeEnvelope(probe), "result"));
  assert.equal(report.verdict.pass, true);
  assert.equal(report.exempt["composition: probe left unread"], 3);
  assert.match(formatCompare(report), /the probe left 3 composition\(s\) unread \(ids 8, 9, 10\)/);
});

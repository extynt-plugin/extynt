/** Tests grouping and mismatch counts of property dynamic flags. */
import assert from "node:assert/strict";
import test from "node:test";
import { compareSnapshots } from "../lib/compare.ts";
import { decodeDynFlags } from "../lib/compare-flags.ts";
import { formatCompare } from "../lib/compare-report.ts";
import { layerOf, layersOf, present, propertyOf, snapshotPair } from "./snapshot-draft.ts";
import type { SnapshotPair } from "./snapshot-draft.ts";

const OPACITY = "ADBE Transform Group/ADBE Opacity";
const POSITION = "ADBE Transform Group/ADBE Position";

function flagged(opacityFlags = 1, positionFlags = 17): SnapshotPair {
  const { probe, native } = snapshotPair();
  for (const side of [probe, native]) {
    for (const layer of layersOf(side)) {
      propertyOf(layer, OPACITY).enabled = true;
      propertyOf(layer, POSITION).enabled = false;
    }
  }
  for (const layer of layersOf(native)) {
    propertyOf(layer, OPACITY).dynFlags = opacityFlags;
    propertyOf(layer, POSITION).dynFlags = positionFlags;
  }
  return { probe, native };
}

test("dynFlags are grouped by probe.enabled with counts, matches and example paths, and are never compared", () => {
  const { probe, native } = flagged();
  const report = compareSnapshots(native, probe, { debugFlags: true, maxExamples: 1 });
  assert.equal(report.verdict.pass, true);
  assert.deepEqual(report.diffs, {});
  assert.equal(present(report.enabledFlags["true|1"]).count, 2);
  assert.equal(present(report.enabledFlags["false|17"]).count, 2);
  assert.equal(present(report.enabledFlags["false|17"]).nativeMatch, 2);
  assert.equal(present(report.enabledFlags["false|17"]).examples.length, 1);
  const text = formatCompare(report);
  assert.match(text, /enabled vs raw flags \(debugFlags\)/);
  assert.match(text, /true\s+1\s+ACTIVE_EYEBALL\s+2\s+native\.enabled matched in all/);
  assert.match(text, /false\s+17\s+ACTIVE_EYEBALL\|DISABLED\s+2\s+native\.enabled matched in all/);
  assert.match(text, /probe\.enabled=false dynFlags=17:\n    comp 5 \/ layer 11 "Layer 11" \/ ADBE Transform Group\/ADBE Position/);
});

test("a native enabled that differs from the probe is counted as a mismatch in its flag group", () => {
  const { probe, native } = flagged();
  propertyOf(layerOf(native, 0), POSITION).enabled = true;
  const report = compareSnapshots(native, probe, { debugFlags: true });
  assert.equal(present(report.enabledFlags["false|17"]).nativeMatch, 1);
  assert.equal(present(report.enabledFlags["false|17"]).nativeMismatch, 1);
  assert.match(formatCompare(report), /native\.enabled matched 1, differed 1/);
  assert.equal(present(report.diffs["property.enabled"]).count, 1);
});

test("entries without a boolean probe.enabled or without native dynFlags are left out", () => {
  const { probe, native } = flagged();
  delete propertyOf(layerOf(probe, 0), OPACITY).enabled;
  delete propertyOf(layerOf(native, 1), POSITION).dynFlags;
  const report = compareSnapshots(native, probe, { debugFlags: true });
  assert.equal(present(report.enabledFlags["true|1"]).count, 1);
  assert.equal(present(report.enabledFlags["false|17"]).count, 1);
});

test("the section shows whenever native entries carry dynFlags, is absent otherwise and explains itself when --debug-flags got none", () => {
  const { probe, native } = flagged();
  assert.match(formatCompare(compareSnapshots(native, probe)), /enabled vs raw flags/);
  const plain = snapshotPair();
  assert.doesNotMatch(formatCompare(compareSnapshots(plain.native, plain.probe)), /enabled vs raw flags/);
  const asked = formatCompare(compareSnapshots(plain.native, plain.probe, { debugFlags: true }));
  assert.match(asked, /enabled vs raw flags \(debugFlags\): no compared native entry carried dynFlags/);
});

test("flag bits are decoded by name", () => {
  assert.equal(decodeDynFlags(0), "(none)");
  assert.equal(decodeDynFlags(1), "ACTIVE_EYEBALL");
  assert.equal(decodeDynFlags(17), "ACTIVE_EYEBALL|DISABLED");
  assert.equal(decodeDynFlags(2 + 32 + 1024), "HIDDEN|ELIDED|SHOWN_WHEN_EMPTY");
  assert.equal(decodeDynFlags(1 + 2048), "ACTIVE_EYEBALL|0x800");
  assert.equal(decodeDynFlags(9), "ACTIVE_EYEBALL|bit3(undocumented)");
  assert.equal(decodeDynFlags(10), "HIDDEN|bit3(undocumented)");
  assert.equal(decodeDynFlags(3), "ACTIVE_EYEBALL|HIDDEN");
});

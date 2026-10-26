/** The control-scale note fires only when a written number lies outside the range the catalogue reports for that control. */
import assert from "node:assert/strict";
import test from "node:test";
import { controlsFromProbeRows, makeHostProfile, makeInventory, type EffectProbeRow, type HostCapabilityProfile } from "@extynt/capability-catalogue";
import type { ActionPlanV2Operation } from "@extynt/action-plan";
import { effectUnitNotices } from "../src/notices.js";

const EFFECT = "Synthetic Fx";
const HOST = { application: "After Effects" as const, version: "26.2", buildNumber: "2", platform: "macOS", architecture: "arm64" };
const ROWS: EffectProbeRow[] = [
  { m: "Fx-Glow", n: "Glow", t: "OneD", v: 1, min: 0, max: 255 },
  { m: "Fx-Fraction", n: "Fraction", t: "OneD", v: 0.5, min: 0, max: 1 },
  { m: "Fx-Check", n: "Check", t: "OneD", v: 1, min: 0, max: 1, dd: true, items: ["Off", "On"] },
];

function profile(): HostCapabilityProfile {
  const base = makeHostProfile(makeInventory(HOST, [{ matchName: EFFECT, displayName: "Synthetic", category: "Synthetic", version: "1", available: true, evidence: [] }]));
  return { ...base, entries: base.entries.map((entry) => (entry.matchName === EFFECT ? { ...entry, controls: controlsFromProbeRows(EFFECT, ROWS) } : entry)) };
}

const write = (control: string, value: number): ActionPlanV2Operation => ({
  type: "set_effect_control", effectMatchName: EFFECT, value,
  target: { compositionId: "C", layerId: "L", effectPath: `ADBE Effect Parade/${EFFECT}`, propertyPath: `ADBE Effect Parade/${EFFECT}/${control}`, snapshotFingerprint: "fp", selectionFingerprint: "sel" },
});

test("a value inside the reported range gets no scale note", () => {
  assert.deepEqual(effectUnitNotices([write("Fx-Glow", 1.4), write("Fx-Glow", 255), write("Fx-Fraction", 0.5)], profile()), []);
});

test("a value outside the reported range gets one note naming the real range", () => {
  const notices = effectUnitNotices([write("Fx-Fraction", 50), write("Fx-Glow", 300)], profile());
  assert.equal(notices.length, 2);
  assert.match(notices[0]?.title ?? "", /accepts 0–1/);
  assert.match(notices[1]?.title ?? "", /accepts 0–255/);
});

test("a popup or checkbox never gets a numeric scale note", () => {
  assert.deepEqual(effectUnitNotices([write("Fx-Check", 1), write("Fx-Check", 50)], profile()), []);
});

test("a control with no catalogue entry gets no note", () => {
  assert.deepEqual(effectUnitNotices([write("Fx-Unknown", 50)], profile()), []);
});

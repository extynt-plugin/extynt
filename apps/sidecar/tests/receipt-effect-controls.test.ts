/** An apply receipt lists the controls of effects it added that the host profile holds no schema for, and teaches the profile. */
import assert from "node:assert/strict";
import test from "node:test";
import { makeHostProfile, makeInventory, type HostCapabilityProfile } from "@extynt/capability-catalogue";
import type { Opaque } from "../src/snapshot-view.js";
import { present } from "./present.js";
import { recordObservedEffectControls, uncachedEffectControls } from "../src/receipt-effect-controls.js";

const host = { application: "After Effects" as const, version: "26.2.1", buildNumber: "2", platform: "macOS", architecture: "arm64" };
const glowRows = [
  { m: "ADBE Glo2-0001", n: "Glow Based On", t: "OneD", v: 1, dd: true, items: ["Color Channels", "Alpha Channel"] },
  { m: "ADBE Glo2-0002", n: "Glow Threshold", t: "OneD", v: 60, min: 0, max: 100 },
  { m: "ADBE Glo2-0009", n: "Glow Colors", t: "OneD", v: 1 },
  { m: "ADBE Glo2-0010", n: "Color A", t: "COLOR", v: [1, 1, 1, 1] },
];
const receipt = () => ({ planId: "p", status: "executed", verification: { steps: [
  { operation: "ensure_effect", created: true, effectMatchName: "ADBE Glo2", controls: glowRows },
  { operation: "ensure_effect", created: false, effectMatchName: "ADBE Drop Shadow", controls: glowRows },
  { operation: "set_effect_control" },
] } });
const profile = (): HostCapabilityProfile => {
  const base = makeHostProfile(makeInventory(host, [{ matchName: "ADBE Glo2", displayName: "Glow", available: true, evidence: [] }]));
  return { ...base, entries: base.entries.map((entry) => entry.matchName === "ADBE Glo2" ? { ...entry, controls: undefined } : entry) };
};

test("the receipt lists controls read back from an added effect with no cached schema", () => {
  const found = uncachedEffectControls(receipt(), profile());
  assert.deepEqual(found.map((entry) => entry.effect), ["ADBE Glo2"], "an effect that already existed adds nothing");
  const controls = present(found[0]).controls;
  assert.deepEqual(controls.map((control) => control.matchName), ["ADBE Glo2-0001", "ADBE Glo2-0002", "ADBE Glo2-0009", "ADBE Glo2-0010"]);
  const threshold = present(controls[1]);
  assert.equal(threshold.path, "ADBE Effect Parade/ADBE Glo2/ADBE Glo2-0002");
  assert.equal(threshold.name, "Glow Threshold");
  assert.equal(threshold.value, 60);
});

test("controls already cached are not repeated, and what was read teaches the profile", () => {
  const cached = profile();
  const withControls = { ...cached, entries: cached.entries.map((entry) => entry.matchName === "ADBE Glo2" ? { ...entry, controls: [{ path: "ADBE Glo2/x", matchName: "x", displayName: "X", valueType: "number" }] } : entry) };
  assert.deepEqual(uncachedEffectControls(receipt(), withControls), []);
  const state: { hostProfile: HostCapabilityProfile | undefined } = { hostProfile: profile() };
  const stored: Record<string, Opaque> = receipt();
  recordObservedEffectControls(state, stored);
  assert.equal(Array.isArray(stored.effectControls), true);
  const learned = present(present(state.hostProfile).entries.find((entry) => entry.matchName === "ADBE Glo2"));
  const learnedControls = learned.controls ?? [];
  assert.equal(learnedControls.length, 4);
  assert.equal(present(learnedControls.find((control) => control.matchName === "ADBE Glo2-0001")).menu?.length, 2);
});

test("a receipt with no added effects is left untouched", () => {
  const stored: Record<string, Opaque> = { planId: "p", status: "executed", verification: { steps: [{ operation: "set_effect_control" }] } };
  recordObservedEffectControls({ hostProfile: profile() }, stored);
  assert.equal("effectControls" in stored, false);
});

// Tests which effects need the user to finish the step in After Effects.
import assert from "node:assert/strict";
import test from "node:test";

import { applyEffectControlEvidence, controlWriteShape, EFFECT_HOST_CAVEATS, makeHostProfile, makeInventory, mergeEffectControlEvidence, userAssistedEffect, type ControlSchema, type InventoryItem } from "../src/index.js";
import { present } from "./present.js";

const host = { application: "After Effects" as const, version: "26.2.1", buildNumber: "2", platform: "macOS", architecture: "arm64" };
const item = (matchName: string, displayName: string, extra: Partial<InventoryItem> = {}): InventoryItem => ({ matchName, displayName, available: true, evidence: [{ kind: "observed", source: "host" }], ...extra });
const profileOf = (...items: InventoryItem[]) => makeHostProfile(makeInventory(host, items));
const entryOf = (profile: ReturnType<typeof profileOf>, matchName: string) => present(profile.entries.find((entry) => entry.matchName === matchName), matchName);
const noteOf = (profile: ReturnType<typeof profileOf>, matchName: string): string => entryOf(profile, matchName).userAssisted?.note ?? "";

test("a dialog-opening Adobe effect is available and user assisted, not refused", () => {
  const entry = entryOf(profileOf(item("ADBE Apply Color LUT2", "Apply Color LUT")), "ADBE Apply Color LUT2");
  assert.equal(entry.availability, "available");
  assert.equal(entry.probeState, "manual-unavailable", "a probe cannot click a dialog, so it is never auto-probed");
  assert.equal(entry.userAssisted?.reason, "opens-dialog");
  assert.match(entry.userAssisted?.note ?? "", /^User assisted: Apply Color LUT opens a dialog when it is added\. Tell the user/);
  assert.ok(entry.requirements?.includes(entry.userAssisted.note));
  assert.equal(EFFECT_HOST_CAVEATS["ADBE Apply Color LUT2"], undefined);
});

test("the two real refusals stay refusals", () => {
  assert.equal(EFFECT_HOST_CAVEATS["ADBE Dropdown Control"]?.code, "EFFECT_INSTANCE_UNIDENTIFIABLE");
  assert.equal(EFFECT_HOST_CAVEATS["CINEMA 4D Effect"]?.code, "EFFECT_NEEDS_HOST_SETUP");
  assert.equal(Object.keys(EFFECT_HOST_CAVEATS).length, 2);
});

test("the census flag hasOptionsDialog marks any effect as may ask for options", () => {
  const profile = profileOf(item("ACME Wizard", "Acme Wizard", { hasOptionsDialog: true }), item("ACME Plain", "Acme Plain"));
  assert.equal(entryOf(profile, "ACME Wizard").userAssisted?.reason, "may-ask-options");
  assert.match(entryOf(profile, "ACME Wizard").userAssisted?.note ?? "", /Acme Wizard may ask for options when it is added/);
  assert.match(entryOf(profile, "ACME Wizard").userAssisted?.note ?? "", /only as a possibility/, "a declared dialog is not promised");
  assert.equal(entryOf(profile, "ACME Plain").userAssisted, undefined);
  assert.equal(entryOf(profile, "ACME Wizard").operationStatus, "probeNeeded", "the flag alone does not stop collection");
});

test("the flag changes the inventory fingerprint so a native update rebuilds the profile", () => {
  assert.notEqual(makeInventory(host, [item("ACME Wizard", "W")]).fingerprint, makeInventory(host, [item("ACME Wizard", "W", { hasOptionsDialog: true })]).fingerprint);
});

test("scan-observed interactive effects become user assisted through the evidence", () => {
  const profile = profileOf(item("ACME Window", "Acme Window"), item("ACME Plain", "Acme Plain"));
  const marked = applyEffectControlEvidence(profile, { userAssisted: ["ACME Window"], effects: {} });
  assert.equal(entryOf(marked, "ACME Window").userAssisted?.reason, "observed-interactive");
  assert.equal(entryOf(marked, "ACME Plain").userAssisted, undefined);
  assert.equal(applyEffectControlEvidence(marked, { userAssisted: ["ACME Window"], effects: {} }), marked, "marking twice is a no-op");
  assert.deepEqual(mergeEffectControlEvidence({ userAssisted: ["A"], effects: {} }, { userAssisted: ["B"], effects: {} })?.userAssisted, ["A", "B"]);
});

test("userAssistedEffect answers for the curated dialog list even without a profile", () => {
  assert.equal(userAssistedEffect(undefined, "ADBE Path Text")?.displayName, "Path Text");
  assert.equal(userAssistedEffect(undefined, "ADBE Gaussian Blur 2"), undefined);
});

test("NO_VALUE and CUSTOM_VALUE controls are described as user assisted", () => {
  const control = (valueType: string): ControlSchema => ({ path: "X/X-0001", matchName: "X-0001", displayName: "Options...", valueType });
  for (const valueType of ["custom", "none"]) {
    const shape = controlWriteShape(control(valueType));
    assert.equal(shape.kind, "user-assisted");
    assert.equal(shape.userAssisted, true);
    assert.match(shape.line, /^user assisted: /);
    assert.match(shape.line, /set it by hand/);
  }
  assert.equal(controlWriteShape(control("number")).userAssisted, false);
});

test("Warp Stabilizer and 3D Camera Tracker are user assisted because they analyse in the background, not because they open a dialog", () => {
  const profile = profileOf(item("ADBE SubspaceStabilizer", "Warp Stabilizer"), item("ADBE 3D Tracker", "3D Camera Tracker"));
  for (const matchName of ["ADBE SubspaceStabilizer", "ADBE 3D Tracker"]) {
    assert.equal(entryOf(profile, matchName).userAssisted?.reason, "analyzes-in-background");
    assert.match(noteOf(profile, matchName), /no script can read whether it has finished/);
    assert.doesNotMatch(noteOf(profile, matchName), /dialog they must finish/);
  }
  assert.match(noteOf(profile, "ADBE 3D Tracker"), /Create Camera and Create Null are buttons only they can press/);
  assert.equal(userAssistedEffect(undefined, "ADBE SubspaceStabilizer")?.reason, "analyzes-in-background");
  assert.equal(userAssistedEffect(profile, "ADBE Gaussian Blur 2"), undefined);
});

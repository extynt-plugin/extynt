// Tests the write shape each control type accepts.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { parseJson } from "./json-input.js";
import { decode } from "@extynt/decode";
import type { JsonValue } from "@extynt/decode";
import {
  BASE_CATALOGUE, hostCapabilityProfile, applyEffectControlEvidence, controlWriteShape, describeControlWrite, describeControlWrites,
  describeEffectWrites, effectControlValueError, findNativeOperation, makeHostProfile, makeInventory, searchHostProfile, type ControlSchema, type HostCapabilityProfile,
} from "../src/index.js";
import { loadFixtureEffectEvidence } from "./effect-evidence-fixture.js";

const HOST = { application: "After Effects" as const, version: "26.2.1", buildNumber: "2", platform: "macOS", architecture: "arm64" };

function decodedProfile(input: JsonValue): HostCapabilityProfile | undefined {
  const result = decode(hostCapabilityProfile, input);
  return result.ok ? result.value : undefined;
}

function censusProfile(): HostCapabilityProfile {
  const evidence = loadFixtureEffectEvidence();
  assert.ok(evidence, "the bundled effect-control evidence must load");
  const inventory = makeInventory(HOST, Object.entries(evidence.effects).map(([matchName, effect]) => ({ matchName, displayName: effect.name ?? matchName, available: true, evidence: [] })));
  return applyEffectControlEvidence(makeHostProfile(inventory), evidence);
}

function leafControls(profile: HostCapabilityProfile): Array<{ effect: string; control: ControlSchema }> {
  return profile.entries
    .filter((entry) => entry.kind === "effect" && typeof entry.matchName === "string" && (entry.controls?.length ?? 0) > 0)
    .flatMap((entry) => (entry.controls ?? []).filter((control) => control.valueType !== "group").map((control) => ({ effect: entry.matchName ?? "", control })));
}

function isPlanControlValue(value: JsonValue | undefined): boolean {
  return typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) || (Array.isArray(value) && value.length >= 2 && value.length <= 4 && value.every((entry) => typeof entry === "number" && Number.isFinite(entry)));
}

test("every census control's write line describes a value the validator accepts", () => {
  const profile = censusProfile();
  const leaves = leafControls(profile);
  assert.ok(leaves.length > 4000, `expected the whole census, walked ${leaves.length} leaf controls`);
  const effects = new Set(leaves.map((entry) => entry.effect));
  assert.ok(effects.size >= 390, `expected every effect with controls, walked ${effects.size}`);
  for (const { effect, control } of leaves) {
    const shape = controlWriteShape(control);
    assert.ok(shape.line.length > 0, `${effect}/${control.matchName} needs a line`);
    assert.equal(shape.matchName, control.matchName);
    if (shape.example === undefined) {
      assert.ok(["structured", "user-assisted", "unknown", "read-only"].includes(shape.kind), `${effect}/${control.matchName} (${shape.kind}) should still carry a specimen`);
      continue;
    }
    assert.equal(effectControlValueError(profile, effect, control.matchName, shape.example), null, `${effect}/${control.matchName}: "${shape.line}" must describe a value the validator accepts`);
    assert.ok(isPlanControlValue(shape.example), `${effect}/${control.matchName}: the described shape must be a legal plan value`);
  }
});

test("a wrong shape is refused exactly where the validator pins the shape, and tolerated where it is silent", () => {
  const profile = censusProfile();
  const refused = new Set<string>();
  const tolerated = new Set<string>();
  for (const { effect, control } of leafControls(profile)) {
    const shape = controlWriteShape(control);
    const wrong = shape.kind === "vector" ? [0, 0, 0, 0, 0] : [0, 0];
    const error = effectControlValueError(profile, effect, control.matchName, wrong);
    if (shape.enforced) {
      assert.ok(error, `${effect}/${control.matchName}: "${shape.line}" is enforced, so a wrong shape must be refused`);
      refused.add(shape.kind);
    } else {
      assert.equal(error, null, `${effect}/${control.matchName}: "${shape.line}" claims no rule, so the validator must stay silent`);
      tolerated.add(shape.kind);
    }
  }
  for (const kind of ["number", "toggle", "menu", "color", "vector"]) assert.ok(refused.has(kind), `the census should contain an enforced ${kind} control`);
  for (const kind of ["index", "user-assisted"]) assert.ok(tolerated.has(kind), `the census should contain a tolerated ${kind} control`);
});

test("the line is derived from the schema, so one schema reads the same way everywhere", () => {
  const control = (fields: Partial<ControlSchema>): ControlSchema => ({ path: `P/${fields.matchName ?? "c"}`, matchName: "c", displayName: "Control", valueType: "number", ...fields });
  assert.equal(describeControlWrite(control({ displayName: "Blurriness", min: 0, max: 30000, defaultValue: 25 })), "Blurriness — one number, 0 to 30000, default 25");
  assert.equal(describeControlWrite(control({ displayName: "Repeat Edge Pixels", min: 0, max: 1, defaultValue: 1 })), "Repeat Edge Pixels — one number 0 or 1, or true/false, default 1");
  assert.equal(describeControlWrite(control({ displayName: "Ramp Shape", valueType: "enum", menu: ["Linear Ramp", "Radial Ramp"], max: 2, defaultValue: 1 })), "Ramp Shape — menu: 1 Linear Ramp, 2 Radial Ramp, default 1 (Linear Ramp)");
  assert.equal(describeControlWrite(control({ displayName: "Start Color", valueType: "color", dimensions: 4, defaultValue: [0, 0, 0, 1] })), "Start Color — 3-4 channels, each 0 to 1, default [0,0,0,1]");
  assert.equal(describeControlWrite(control({ displayName: "Start of Ramp", valueType: "vector", dimensions: 2, defaultValue: [640, 0] })), "Start of Ramp — two numbers, default [640,0]");
  assert.equal(describeControlWrite(control({ displayName: "Center", valueType: "vector", defaultValue: [640, 360] })), "Center — an array of numbers (this schema does not state how many), default [640,360]");
  assert.equal(describeControlWrite(control({ displayName: "Iris Properties", valueType: "none" })), "Iris Properties — user assisted: After Effects has no value a script can write here (custom control, button or options panel). Do not plan a write to it; tell the user to set it by hand in After Effects");
  assert.equal(describeControlWrite(control({ displayName: "Path Options", valueType: "unknown", canSetValue: false })), "Path Options — read-only: After Effects reports it cannot be set");
  assert.equal(describeControlWrite(control({ displayName: "Depth of Field", valueType: "boolean", defaultValue: false })), "Depth of Field — true or false, default false");
  assert.equal(describeControlWrite(control({ displayName: "Blur Layer", valueType: "layer", defaultValue: 1, animatable: false })), "Blur Layer — a layer index number, default 1; cannot be keyframed");
  assert.equal(describeControlWrite(control({ displayName: "Opacity", min: 0 })), "Opacity — one number, 0 or more");
  assert.equal(describeControlWrite(control({ matchName: "ADBE Ramp-0002", displayName: "" })), "ADBE Ramp-0002 — one number");
  assert.notEqual(describeControlWrite(control({ displayName: "Blurriness", min: 0, max: 300 })), describeControlWrite(control({ displayName: "Blurriness", min: 0, max: 30000 })));
  assert.equal(describeControlWrites([control({ valueType: "group" }), control({ displayName: "A" }), control({ displayName: "B" })], 1).length, 1);
  const withRole = controlWriteShape(control({ displayName: "Blurriness", role: "blur.amount" }));
  assert.equal(withRole.role, "blur.amount");
});

test("the measured OneD shape reads as one number on the real Gaussian Blur control", () => {
  const profile = censusProfile();
  const entry = profile.entries.find((candidate) => candidate.matchName === "ADBE Gaussian Blur 2");
  assert.ok(entry, "the census must carry ADBE Gaussian Blur 2");
  const blurriness = entry.controls?.find((candidate) => candidate.matchName === "ADBE Gaussian Blur 2-0001");
  assert.ok(blurriness);
  assert.equal(blurriness.valueType, "number");
  assert.equal(controlWriteShape(blurriness).kind, "number");
  assert.equal(describeControlWrite(blurriness), "Blurriness — one number, 0 to 30000, default 25");
  assert.equal(effectControlValueError(profile, "ADBE Gaussian Blur 2", "ADBE Gaussian Blur 2-0001", [20, 20]), "Blurriness takes one number, not an array.");
  assert.equal(effectControlValueError(profile, "ADBE Gaussian Blur 2", "ADBE Gaussian Blur 2-0001", 40), null);
});

test("the host search already finds the effect family; the lever lines are what tell its members apart", () => {
  const live = decodedProfile(parseJson(readFileSync("tools/chat-tests/fixtures/host-profile/host-capability-profile.json", "utf8")));
  if (!live) assert.fail("the committed fixture must be a host capability profile");
  assert.equal(live.entries.filter((entry) => entry.kind === "effect").length, 399);
  const evidence = loadFixtureEffectEvidence();
  assert.ok(evidence);
  assert.equal(Object.keys(evidence.effects).filter((key) => /blur/i.test(key)).length, 17);
  assert.equal(Object.values(evidence.effects).filter((effect) => /blur/i.test(effect.name ?? "")).length, 18);
  assert.equal(evidence.effects["ADBE Bilateral"]?.name, "Bilateral Blur");
  assert.equal(live.entries.filter((entry) => entry.kind === "effect" && /blur/i.test(entry.displayName)).length, 18);
  assert.ok(searchHostProfile(live, "blur", 50).entries.length >= 20);
  const lines = (matchName: string) => describeEffectWrites(live, matchName)?.controls ?? [];
  assert.ok(lines("ADBE Gaussian Blur 2").includes("Blurriness — one number, 0 to 30000, default 25"));
  assert.ok(lines("CC Radial Blur").some((line) => line.startsWith("Center — two numbers")), "a positional control is two numbers");
  assert.ok(lines("ADBE Compound Blur").some((line) => line.startsWith("Blur Layer — a layer index number")), "a control that is not a plain value says so");
  assert.equal(describeEffectWrites(live, "nothing-with-this-id"), undefined);
  assert.equal(describeEffectWrites(live, "ADBE Gaussian Blur 2")?.id, "adobe.gaussian-blur");
});

function keyframeRule(id: string): string {
  return String(findNativeOperation(id)?.inputSchema.properties.keyframes?.description ?? "");
}

function settingsRule(): string {
  return String(findNativeOperation("composition.update-settings")?.inputSchema.properties.settings?.description ?? "");
}

function operationDescription(id: string): string {
  return String(findNativeOperation(id)?.description);
}

test("each measured host quirk is stated where the describing agent reads it", () => {
  for (const id of ["shape.primitive", "shape.gradient", "shape.operator"]) {
    assert.match(keyframeRule(id), /one setting may be written in one place only/i, `${id} must state the set-or-keyframe rule`);
  }
  assert.match(operationDescription("text.animator"), /one value may be written in one place only/i);
  const parent = findNativeOperation("parenting.set");
  assert.match(operationDescription("parenting.set"), /compensates position/i);
  assert.match(operationDescription("parenting.set"), /\[220,130,0\]/, "the compensation is stated with the measured numbers (probe q1)");
  assert.ok(!/(becomes|ends at|reading back|reads back as) \[60,40\]/.test(operationDescription("parenting.set")), "the disproved figure must not survive as a claim");
  assert.match((parent?.preconditions ?? []).join(" "), /parent first|restate/i, "and with the fix");
  assert.match(settingsRule(), /8-bit precision \(1\/255\)/);
  assert.match(settingsRule(), /0\.10196078431373/, "with the measured read-back");
  assert.match(operationDescription("shape.gradient"), /NO_VALUE/, "the gradient colour-stop limit is stated at the operation that hits it");
  assert.match(operationDescription("shape.gradient"), /set_track_matte/, "and with the realisation the host allows");
  assert.match(String(BASE_CATALOGUE.capabilities.find((capability) => capability.id === "adobe.gradient-ramp")?.description), /track matte/i, "the Ramp capability names the matte technique too");
});

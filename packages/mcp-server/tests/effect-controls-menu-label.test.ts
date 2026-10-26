// Tests for effect controls menu label.
import assert from "node:assert/strict";
import test from "node:test";
import { controlsFromProbeRows, makeHostProfile, makeInventory, type HostCapabilityProfile } from "@extynt/capability-catalogue";
import { representativeSnapshot, type ProjectSnapshot, type PropertySnapshot } from "@extynt/project-graph";
import { callTool } from "../src/index.js";

const EFFECT = "Synthetic Fx";
const HOST = { application: "After Effects" as const, version: "26.2", buildNumber: "2", platform: "macOS", architecture: "arm64" };
const prop = (matchName: string, value: number): PropertySnapshot => ({ path: `ADBE Effect Parade/${EFFECT}/${matchName}`, matchName, displayName: matchName, kind: "property", valueType: "number", value, canSetValue: true });

function snapshot(): ProjectSnapshot {
  const base = structuredClone(representativeSnapshot);
  const layer = base.compositions[0]?.layers[0];
  if (!layer) throw new Error("the representative snapshot lost its first layer");
  layer.properties = [{ path: "ADBE Effect Parade", matchName: "ADBE Effect Parade", displayName: "Effects", kind: "group", valueType: "unknown", value: null, canSetValue: false, children: [
    { path: `ADBE Effect Parade/${EFFECT}`, matchName: EFFECT, displayName: "Synthetic", kind: "effect", valueType: "unknown", value: null, canSetValue: false, children: [prop("Fx-Menu", 2), prop("Fx-Plain", 5)] },
  ] }];
  return base;
}

function profile(): HostCapabilityProfile {
  const base = makeHostProfile(makeInventory(HOST, [{ matchName: EFFECT, displayName: "Synthetic", category: "Synthetic", version: "1", available: true, evidence: [] }]));
  const rows = [{ m: "Fx-Menu", n: "Menu", t: "OneD", v: 1, min: 1, max: 3, dd: true, items: ["A", "B", "C"] }, { m: "Fx-Plain", n: "Plain", t: "OneD", v: 1, min: 0, max: 10 }];
  return { ...base, entries: base.entries.map((entry) => (entry.matchName === EFFECT ? { ...entry, controls: controlsFromProbeRows(EFFECT, rows) } : entry)) };
}

test("ae_get_effect_controls names the item a popup currently holds, only for popups", () => {
  const result = callTool("ae_get_effect_controls", { matchName: EFFECT }, { snapshot: snapshot(), hostProfile: profile() });
  assert.equal(result.ok, true);
  const text = JSON.stringify(result);
  assert.match(text, /"matchName":"Fx-Menu".*?"valueLabel":"B"/);
  assert.equal(text.split("valueLabel").length, 2);
});

test("without a host profile the controls read as before", () => {
  const result = callTool("ae_get_effect_controls", { matchName: EFFECT }, { snapshot: snapshot() });
  assert.doesNotMatch(JSON.stringify(result), /valueLabel/);
});

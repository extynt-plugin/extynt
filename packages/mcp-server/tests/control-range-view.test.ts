// Proves that the effect listing places a control in the range After Effects reported and labels its unit, and shows nothing where After Effects reported none.
import assert from "node:assert/strict";
import test from "node:test";
import { array, decodeOrThrow, jsonObject, type JsonObject, object, optional, string } from "@extynt/decode";
import { BASE_CATALOGUE, makeHostProfile, makeInventory, controlsFromProbeRows, type EffectProbeRow, type HostCapabilityProfile } from "@extynt/capability-catalogue";
import { representativeSnapshot, type ProjectSnapshot, type PropertySnapshot } from "@extynt/project-graph";
import { callTool } from "../src/index.js";
import { toMcpToolResult } from "../src/transport.js";
import { arrayAt, objectsIn, stringAt } from "../src/json.js";
import { parsedJson } from "./support/narrow.js";
import { successObject } from "./support/proposal-views.js";

const EFFECT = "Synthetic Fx";
const HOST = { application: "After Effects" as const, version: "26.2", buildNumber: "2", platform: "macOS", architecture: "arm64" };
const prop = (matchName: string, name: string, value: number | number[], valueType: PropertySnapshot["valueType"] = "number"): PropertySnapshot => ({ path: `ADBE Effect Parade/${EFFECT}/${matchName}`, matchName, displayName: name, kind: "property", valueType, value, canSetValue: true });
const ROWS: EffectProbeRow[] = [
  { m: "Fx-Size", n: "Size", t: "OneD", v: 10, min: 0, max: 200, u: "pixels" },
  { m: "Fx-Plain", n: "Plain", t: "OneD", v: 1, min: 0, max: 10 },
  { m: "Fx-Unbounded", n: "Unbounded", t: "OneD", v: 1, u: "degrees" },
  { m: "Fx-Menu", n: "Menu", t: "OneD", v: 1, min: 1, max: 3, dd: true, items: ["A", "B", "C"] },
  { m: "Fx-Origin", n: "Origin", t: "TwoD", v: [0, 0], min: 0, max: 100, u: "pixels" },
];
const PLAIN_LISTING = ["Fx-Size|Size=25", "Fx-Plain|Plain=5", "Fx-Unbounded|Unbounded=7", "Fx-Menu|Menu=2", "Fx-Origin|Origin=[10,20]", "Fx-Unseen|Unseen=3"];

const listingView = object({ data: array(object({ effects: array(object({ controls: array(string()) })) })) });
const textContent = object({ content: array(object({ text: string() })) });
const reportedProperties = array(object({ effects: array(object({ properties: array(object({ matchName: string(), reportedRange: optional(jsonObject) })) })) }));

function snapshot(): ProjectSnapshot {
  const base = structuredClone(representativeSnapshot);
  const layer = base.compositions[0]?.layers[0];
  assert.ok(layer, "the representative snapshot has a first layer");
  layer.properties = [{ path: "ADBE Effect Parade", matchName: "ADBE Effect Parade", displayName: "Effects", kind: "group", valueType: "unknown", value: null, canSetValue: false, children: [
    { path: `ADBE Effect Parade/${EFFECT}`, matchName: EFFECT, displayName: "Synthetic", kind: "effect", valueType: "unknown", value: null, canSetValue: false, children: [
      prop("Fx-Size", "Size", 25), prop("Fx-Plain", "Plain", 5), prop("Fx-Unbounded", "Unbounded", 7), prop("Fx-Menu", "Menu", 2), prop("Fx-Origin", "Origin", [10, 20], "vector"), prop("Fx-Unseen", "Unseen", 3),
    ] },
  ] }];
  return base;
}

function profile(rows: EffectProbeRow[] | null = ROWS): HostCapabilityProfile {
  const base = makeHostProfile(makeInventory(HOST, [{ matchName: EFFECT, displayName: "Synthetic", category: "Synthetic", version: "1", available: true, evidence: [] }]));
  return { ...base, entries: base.entries.map((entry) => (entry.matchName === EFFECT && rows ? { ...entry, controls: controlsFromProbeRows(EFFECT, rows) } : entry)) };
}

function controlsOf(hostProfile: HostCapabilityProfile | undefined): ReadonlyArray<string> {
  const result = callTool("ae_list_effects_and_expressions", {}, { snapshot: snapshot(), ...(hostProfile ? { hostProfile } : {}) });
  assert.ok(result.ok);
  const mcp = decodeOrThrow(textContent, toMcpToolResult({ ...result }));
  const text = mcp.content[0]?.text ?? "";
  const view = decodeOrThrow(listingView, parsedJson(text));
  const controls = view.data[0]?.effects[0]?.controls;
  assert.ok(controls, "the first effect lists its controls");
  return controls;
}

function reportedRanges(): ReadonlyMap<string, JsonObject | undefined> {
  const result = callTool("ae_list_effects_and_expressions", {}, { snapshot: snapshot(), hostProfile: profile() });
  assert.ok(result.ok);
  const layers = decodeOrThrow(reportedProperties, result.data);
  const properties = layers[0]?.effects[0]?.properties ?? [];
  return new Map(properties.map((property) => [property.matchName, property.reportedRange]));
}

test("ae_list_effects_and_expressions shows a control's place in the range AE reported, with the unit label, and nothing where AE reported none", () => {
  assert.deepEqual(controlsOf(profile()), [
    "Fx-Size|Size=25 (12.5% of 0–200 pixels)",
    "Fx-Plain|Plain=5 (50% of 0–10)",
    "Fx-Unbounded|Unbounded=7",
    "Fx-Menu|Menu=2",
    "Fx-Origin|Origin=[10,20]",
    "Fx-Unseen|Unseen=3",
  ]);
});

test("without a catalogue probe of the effect the listing is exactly what it was: no range, no unit, no position", () => {
  assert.deepEqual(controlsOf(undefined), PLAIN_LISTING);
  assert.deepEqual(controlsOf(profile(null)), PLAIN_LISTING, "an effect in the profile with no probed controls");
  assert.deepEqual(controlsOf(profile([{ m: "Fx-Size", n: "Size", t: "OneD", v: 10 }])), PLAIN_LISTING, "controls with no reported range or unit add nothing");
});

test("a value outside the reported range gets no position instead of a wrong one", () => {
  const rows: EffectProbeRow[] = [{ m: "Fx-Size", n: "Size", t: "OneD", v: 10, min: 0, max: 20, u: "pixels" }];
  assert.equal(controlsOf(profile(rows))[0], "Fx-Size|Size=25");
});

test("the full tool result carries the reported range with its source, and says the slider range is not observed", () => {
  const byName = reportedRanges();
  assert.deepEqual(byName.get("Fx-Size"), { minimum: 0, maximum: 200, units: "pixels", position: 0.125, ofDefault: 2.5, reason: null, source: "after-effects-valid-range" });
  assert.deepEqual(byName.get("Fx-Unbounded"), { minimum: null, maximum: null, units: "degrees", position: null, ofDefault: 7, reason: "range-unobserved", source: "after-effects-valid-range" });
  assert.equal(byName.get("Fx-Origin")?.position, null, "a vector has no single position");
  assert.equal(byName.get("Fx-Origin")?.reason, "not-numeric-scalar");
  assert.equal(byName.get("Fx-Unseen"), undefined);
});

test("ae_describe_host_capability detail=controls rows carry units when AE reported them and omit the key otherwise", () => {
  const data = successObject(callTool("ae_describe_host_capability", { id: `host:${EFFECT}`, detail: "controls" }, { hostProfile: profile() }));
  const byName = new Map(objectsIn(arrayAt(data, "items")).map((item) => [stringAt(item, "matchName"), item]));
  assert.equal(byName.get("Fx-Size")?.units, "pixels");
  assert.equal(byName.get("Fx-Size")?.max, 200);
  assert.equal(byName.get("Fx-Unbounded")?.units, "degrees");
  for (const name of ["Fx-Plain", "Fx-Menu"]) {
    const item = byName.get(name);
    assert.ok(item, `${name} is listed`);
    assert.equal("units" in item, false, "no unit is invented when AE reports none");
  }
  assert.ok(BASE_CATALOGUE.capabilities.every((capability) => (capability.controls ?? []).every((control) => control.units === undefined)), "the bundled catalogue carries no unit labels: they come only from this machine's probe");
});

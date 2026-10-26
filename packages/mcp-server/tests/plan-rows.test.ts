// Tests for plan rows.
import test from "node:test";
import assert from "node:assert/strict";
import { controlsFromProbeRows, makeHostProfile, makeInventory, type HostCapabilityProfile } from "@extynt/capability-catalogue";
import { createSnapshot, representativeSnapshot, type ProjectSnapshot, type PropertySnapshot, type SnapshotInput } from "@extynt/project-graph";
import { callTool, type StoredPlan } from "../src/index.js";
import { operationsOf } from "../src/operations.js";
import { presentPlanRows, type PlanValueRow } from "../src/plan-rows.js";
import { arrayAt, objectAt, objectsIn, stringAt } from "../src/json.js";
import type { JsonObject } from "@extynt/decode";
import { resultData } from "./support/json-results.js";


const CRATE = { compositionId: "comp-main", layerId: "layer-crate" };
const TITLE = { compositionId: "comp-main", layerId: "layer-title" };
const OPACITY = "ADBE Transform Group/ADBE Opacity";
const POSITION = "ADBE Transform Group/ADBE Position";

function leaf(path: string, displayName: string, value: PropertySnapshot["value"], valueType: PropertySnapshot["valueType"]): PropertySnapshot {
  return { path, matchName: path.split("/").at(-1) ?? path, displayName, kind: "property", valueType, value, canSetValue: true };
}

function crateSnapshot(): ProjectSnapshot {
  const { fingerprint: _fingerprint, selectionFingerprint: _selection, freshness: _freshness, ...input }: SnapshotInput & Partial<ProjectSnapshot> = structuredClone(representativeSnapshot);
  const comp = input.compositions[0];
  const footage = comp?.layers[1];
  if (!comp || !footage) throw new Error("the representative snapshot lost its layers");
  const crate = { ...structuredClone(footage), id: "layer-crate", name: "WOODEN_CRATE", isSelected: false, properties: [{
    path: "ADBE Transform Group", matchName: "ADBE Transform Group", displayName: "Transform", kind: "group" as const, valueType: "unknown" as const, value: null, canSetValue: false,
    children: [leaf(OPACITY, "Opacity", 100, "number"), leaf(POSITION, "Position", [960, 540, 0], "vector"), leaf("ADBE Transform Group/ADBE Scale", "Scale", [100, 100, 100], "vector")],
  }] };
  comp.layers.push(crate);
  return createSnapshot(input);
}

function rows(operations: JsonObject[], snapshot: ProjectSnapshot = representativeSnapshot): PlanValueRow[] {
  return presentPlanRows(snapshot, operationsOf(operations));
}

function presentedValues(result: ReturnType<typeof callTool>): ReadonlyArray<JsonObject> {
  return objectsIn(arrayAt(objectAt(resultData(result), "presentation"), "values"));
}

test("a rename, an opacity change and a position change say what changes, with the values read from the project", () => {
  const snapshot = crateSnapshot();
  const result = rows([
    { type: "set_layer_name", target: CRATE, name: "WOODEN_CRATE_R4" },
    { type: "set_layer_property", target: { ...CRATE, propertyPath: OPACITY }, role: "transform.opacity", propertyPath: OPACITY, value: 55 },
    { type: "set_layer_property", target: { ...CRATE, propertyPath: POSITION }, role: "transform.position", propertyPath: POSITION, value: [970, 540, 0] },
  ], snapshot);
  assert.deepEqual(result, [
    { label: "Rename layer", target: "WOODEN_CRATE", before: "WOODEN_CRATE", after: "WOODEN_CRATE_R4" },
    { label: "Opacity", target: "WOODEN_CRATE_R4", before: "100", after: "55" },
    { label: "Position", target: "WOODEN_CRATE_R4", before: "960, 540, 0", after: "970, 540, 0" },
  ]);
});

test("a second write to the same property reads the first write as its before value", () => {
  const snapshot = crateSnapshot();
  const result = rows([
    { type: "set_layer_property", target: { ...CRATE, propertyPath: OPACITY }, role: "transform.opacity", propertyPath: OPACITY, value: 55 },
    { type: "set_layer_property", target: { ...CRATE, propertyPath: OPACITY }, role: "transform.opacity", propertyPath: OPACITY, value: 20.456 },
  ], snapshot);
  assert.deepEqual(result.map((row) => [row.before, row.after]), [["100", "55"], ["55", "20.46"]]);
});

test("a property the project has not read has no before value, never the operation type", () => {
  const result = rows([{ type: "set_layer_property", target: { ...TITLE, propertyPath: OPACITY }, role: "transform.opacity", propertyPath: OPACITY, value: 40 }]);
  assert.deepEqual(result, [{ label: "Opacity", target: "TITLE — Summer", before: null, after: "40" }]);
});

test("keyframes read as a count, with the property's current value or key count before", () => {
  const keyed = rows([{ type: "animate_property", target: { ...CRATE, propertyPath: OPACITY }, role: "transform.opacity", keyframes: [{ time: 0, value: 0 }, { time: 1, value: 50 }, { time: 2, value: 100 }] }], crateSnapshot());
  assert.deepEqual(keyed, [{ label: "Add keyframes: Opacity", target: "WOODEN_CRATE", before: "100", after: "3 keys" }]);
  const existing = rows([{ type: "animate_property", target: { ...TITLE, propertyPath: POSITION }, keyframes: [{ time: 0, value: [0, 0] }] }]);
  assert.equal(existing[0]?.label, "Add keyframes: Position");
  assert.equal(existing[0]?.after, "1 key");
});

test("an effect is named in plain words and a control carries its effect", () => {
  const result = rows([
    { type: "ensure_effect", target: TITLE, capabilityId: "ae:ADBE Drop Shadow", effectMatchName: "ADBE Drop Shadow", effectPath: "ADBE Effect Parade/ADBE Drop Shadow" },
    { type: "set_effect_control", target: { ...TITLE, effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2", propertyPath: "ADBE Effect Parade/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001" }, effectMatchName: "ADBE Gaussian Blur 2", value: 24 },
  ]);
  assert.deepEqual(result[0], { label: "Add effect: Drop Shadow", target: "TITLE — Summer", before: null, after: null });
  assert.deepEqual(result[1], { label: "Blurriness (Gaussian Blur)", target: "TITLE — Summer", before: "12", after: "24" });
});

test("a second instance of an effect is named the way AE numbers it, with or without its match name", () => {
  const effectPath = "ADBE Effect Parade/ADBE Gaussian Blur 2#2";
  const result = rows([
    { type: "ensure_effect", target: TITLE, capabilityId: "adobe.gaussian-blur", effectMatchName: "ADBE Gaussian Blur 2", effectPath },
    { type: "set_effect_control", target: { ...TITLE, effectPath, propertyPath: `${effectPath}/ADBE Gaussian Blur 2-0001` }, effectMatchName: "ADBE Gaussian Blur 2", value: 8 },
    { type: "set_effect_control", target: { ...TITLE, effectPath, propertyPath: `${effectPath}/ADBE Gaussian Blur 2-0001` }, value: 9 },
  ]);
  assert.deepEqual(result.map((row) => row.label), ["Add effect: Gaussian Blur 2", "Blurriness (Gaussian Blur 2)", "Blurriness (Gaussian Blur 2)"]);
});

function thirdPartyProfile(): HostCapabilityProfile {
  const host = { application: "After Effects" as const, version: "26.2", buildNumber: "2", platform: "macOS", architecture: "arm64" };
  const base = makeHostProfile(makeInventory(host, [{ matchName: "VEN Glowie", displayName: "Glowie", category: "Vendor", version: "1", available: true, evidence: [] }]));
  const controls = controlsFromProbeRows("VEN Glowie", [{ m: "VEN Glowie-0003", n: "Bloom Radius", t: "OneD", v: 10, min: 0, max: 100 }]);
  return { ...base, entries: base.entries.map((entry) => (entry.matchName === "VEN Glowie" ? { ...entry, controls } : entry)) };
}

test("a control on an effect the plan adds is named the way this host named it", () => {
  const effectPath = "ADBE Effect Parade/VEN Glowie";
  const operations = operationsOf([
    { type: "ensure_effect", target: TITLE, capabilityId: "host:VEN Glowie", effectMatchName: "VEN Glowie", effectPath },
    { type: "set_effect_control", target: { ...TITLE, effectPath, propertyPath: `${effectPath}/VEN Glowie-0003` }, effectMatchName: "VEN Glowie", value: 40 },
  ]);
  const named = presentPlanRows(representativeSnapshot, operations, thirdPartyProfile());
  assert.equal(named[0]?.label, "Add effect: Glowie");
  assert.equal(named[1]?.label, "Bloom Radius (Glowie)");
  assert.notEqual(presentPlanRows(representativeSnapshot, operations)[1]?.label, "Bloom Radius (Glowie)", "without the profile only the match name is left to read");
});

test("a Gaussian created with values names its direction and edge mode in words", () => {
  const blur = "ADBE Effect Parade/ADBE Gaussian Blur 2";
  const create = (dimensions: number, repeatEdgePixels: boolean) => rows([{ type: "ensure_effect", target: TITLE, capabilityId: "adobe.gaussian-blur", effectMatchName: "ADBE Gaussian Blur 2", effectPath: blur, enabled: true, initialization: { blurriness: 25, dimensions, repeatEdgePixels } }])[0]?.after;
  assert.equal(create(1, true), "enabled, blurriness 25, both directions, edges repeated");
  assert.equal(create(2, false), "enabled, blurriness 25, horizontal only, edges not repeated");
  assert.equal(create(3, false), "enabled, blurriness 25, vertical only, edges not repeated");
});

test("text, colours and layers created by the plan read as what they set", () => {
  const result = rows([
    { type: "set_text_document", target: TITLE, text: "Autumn\rSale" },
    { type: "set_text_document", target: TITLE, fontSize: 48, fillColor: [1, 0, 0] },
    { type: "create_layer", target: { compositionId: "comp-main", layerId: "__new__:bar" }, layerType: "shape", name: "Bar" },
    { type: "ensure_shape_fill", target: { compositionId: "comp-main", layerId: "__new__:bar" }, groupId: "root", color: [0.2, 0.4, 0.6] },
  ]);
  assert.deepEqual(result[0], { label: "Set text", target: "TITLE — Summer", before: "Summer", after: "Autumn Sale" });
  assert.deepEqual(result[1], { label: "Restyle text", target: "TITLE — Summer", before: null, after: "font size 48, fill color #FF0000" });
  assert.deepEqual(result[2], { label: "Add shape layer", target: "Bar", before: null, after: null });
  assert.deepEqual(result[3], { label: "Shape fill", target: "Bar", before: null, after: "#336699" });
});

test("long text and every unknown operation stay plain: cut at 40 characters, labelled in words, never the raw type", () => {
  const long = rows([{ type: "set_text_document", target: TITLE, text: "word ".repeat(40) }]);
  assert.equal(long[0]?.after?.length, 40);
  const unknown = rows([{ type: "frobnicate_widget", target: TITLE }]);
  assert.equal(unknown[0]?.label, "Frobnicate widget");
  assert.equal(unknown[0]?.before, null);
  assert.equal(unknown[0]?.after, null);
});

test("expressions and file paths are disclosed whole enough to approve", () => {
  const result = rows([
    { type: "set_expression", target: { ...TITLE, propertyPath: POSITION }, source: "wiggle(3, 30)", enabled: true },
    { type: "import_file", newItemId: "__new__:i", path: "/Users/me/footage/clip.mov" },
    { type: "render_composition", compositionId: "comp-main", outputPath: "/Users/me/out/main.mov", destinationPolicy: "explicit-local-path" },
  ]);
  assert.deepEqual(result[0], { label: "Set expression: Position", target: "TITLE — Summer", before: "wiggle(2, 20)", after: "expression: wiggle(3, 30)" });
  assert.equal(result[1]?.after, "source /Users/me/footage/clip.mov");
  assert.deepEqual([result[2]?.label, result[2]?.target, result[2]?.after], ["Queue render", "Main", "destination /Users/me/out/main.mov"]);
});

test("layer switches, parenting, timing and ordering read from the layer's current state", () => {
  const result = rows([
    { type: "set_layer_attribute", target: TITLE, role: "blend-mode", value: "MULTIPLY" },
    { type: "set_layer_attribute", target: TITLE, role: "shy", value: true },
    { type: "set_layer_parent", target: TITLE, parentLayerId: "layer-footage" },
    { type: "set_layer_timing", target: TITLE, inPoint: 1, outPoint: 3.5 },
    { type: "reorder_layer", target: TITLE, placement: "end" },
  ]);
  assert.deepEqual(result.map((row) => [row.label, row.before, row.after]), [
    ["Blend mode", null, "Multiply"], ["Shy", "off", "on"], ["Set parent", "None", "Plate"], ["Layer timing", "in 0s, out 4s", "in 1s, out 3.5s"], ["Move layer", null, "to bottom"],
  ]);
});

test("ae_propose_plan returns the same rows on its presentation, one per operation", () => {
  const snapshot = crateSnapshot();
  const context = { snapshot, plans: new Map<string, StoredPlan>() };
  const proposal = callTool("ae_propose_plan", { summary: "Tweak the crate", operations: [
    { type: "set_layer_name", target: CRATE, name: "WOODEN_CRATE_R4" },
    { type: "set_layer_property", target: CRATE, role: "transform.opacity", propertyPath: OPACITY, value: 55 },
  ] }, context);
  assert.equal(proposal.ok, true, JSON.stringify(proposal.ok ? null : proposal.error));
  const values = presentedValues(proposal);
  assert.deepEqual(values.map((row) => [row.label, row.target, row.before, row.after]), [
    ["Rename layer", "WOODEN_CRATE", "WOODEN_CRATE", "WOODEN_CRATE_R4"], ["Opacity", "WOODEN_CRATE_R4", "100", "55"],
  ]);
});

test("ae_plan_add reports the presentation of the plan so far with real before values", () => {
  const snapshot = crateSnapshot();
  const context = { snapshot, plans: new Map<string, StoredPlan>() };
  const created = callTool("ae_plan_create", { summary: "Tweak the crate" }, context);
  assert.equal(created.ok, true);
  const planId = stringAt(resultData(created), "planId") ?? "";
  const added = callTool("ae_plan_add", { planId, operations: [
    { type: "set_layer_name", target: CRATE, name: "WOODEN_CRATE_R4" },
    { type: "set_layer_property", target: CRATE, role: "transform.opacity", propertyPath: OPACITY, value: 55 },
    { type: "set_layer_property", target: CRATE, role: "transform.position", propertyPath: POSITION, value: [970, 540, 0] },
  ] }, context);
  assert.equal(added.ok, true, JSON.stringify(added.ok ? null : added.error));
  const values = presentedValues(added);
  assert.deepEqual(values, [
    { label: "Rename layer", target: "WOODEN_CRATE", before: "WOODEN_CRATE", after: "WOODEN_CRATE_R4" },
    { label: "Opacity", target: "WOODEN_CRATE_R4", before: "100", after: "55" },
    { label: "Position", target: "WOODEN_CRATE_R4", before: "960, 540, 0", after: "970, 540, 0" },
  ]);
  const sealed = callTool("ae_plan_complete", { planId }, context);
  assert.equal(sealed.ok, true, JSON.stringify(sealed.ok ? null : sealed.error));
  assert.deepEqual(presentedValues(sealed), values, "sealing keeps the same rows");
});

// Tests that the native operation registry is fully covered by proposal fixtures that reach the host compiler, and that effect, evidence and path checks answer as the registry promises.
import test from "node:test";
import assert from "node:assert/strict";
import { array, boolean, decodeOrThrow, jsonValue, number, object, optional, record, string } from "@extynt/decode";
import { representativeSnapshot } from "@extynt/project-graph";
import type { ProjectSnapshot } from "@extynt/project-graph";
import { makeHostProfile, makeInventory, makePresetInventory, NATIVE_OPERATION_REGISTRY, applyEffectControlEvidence, mergeEffectControlEvidence } from "@extynt/capability-catalogue";
import type { HostCapabilityProfile } from "@extynt/capability-catalogue";
import { loadFixtureEffectEvidence } from "@extynt/capability-catalogue/test-evidence";
import { validateActionPlan } from "@extynt/action-plan";
import { callTool, listTools } from "../src/index.js";
import type { StoredPlan } from "../src/index.js";
import { arrayAt, jsonFieldsOf, objectAt, stringAt, stringsIn } from "../src/json.js";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { compiledPlan } from "./support/compiled-plan.js";
import { payloadOf, refusalOf, resultData, rowsOf } from "./support/json-results.js";
import { proposalFixtures } from "./support/native-fixtures.js";

const HOST = { application: "After Effects" as const, version: "26.2.1", buildNumber: "2", platform: "macOS", architecture: "arm64" };
const BLUR_PATH = "ADBE Effect Parade/ADBE Gaussian Blur 2";
const GLOW_PATH = "ADBE Effect Parade/ADBE Glo2";

const summaryView = object({ schemaVersion: string(), domains: number(), operations: number(), counts: object({ implemented: number(), probe_needed: number() }) });
const searchView = object({ entries: array(object({ id: optional(string()), inputSchema: optional(jsonValue) })) });
const describedView = object({
  implementationStatus: string(), schemaVersion: string(), planType: string(), planShape: string(),
  inputSchema: object({ required: array(string()), properties: record(string(), object({})) }),
});
const presentationView = object({
  presentation: object({
    notices: array(object({ severity: string(), code: optional(string()) })),
    verification: object({ requiresAcknowledgement: boolean() }),
  }),
});
const controlsView = object({ items: array(object({ path: string() })), writeShapes: optional(array(string())) });

const installed = (matchName: string): { matchName: string; displayName: string; available: true; evidence: [{ kind: "observed"; source: "host" }] } => ({ matchName, displayName: matchName, available: true, evidence: [{ kind: "observed", source: "host" }] });

function firstLayerTarget(snapshot: ProjectSnapshot = representativeSnapshot): { compositionId: string; layerId: string } {
  const composition = snapshot.compositions[0];
  const layer = composition?.layers[0];
  assert.ok(composition && layer, "the representative snapshot has a first layer");
  return { compositionId: composition.id, layerId: layer.id };
}

function assertRegistryListsCoverage(): void {
  const summary = decodeOrThrow(summaryView, payloadOf(callTool("ae_list_native_operations", {}, {})));
  assert.equal(summary.schemaVersion, "0.1");
  assert.ok(summary.domains >= 15);
  assert.ok(summary.operations >= 38);
  assert.ok(summary.counts.implemented > 0);
  assert.equal(summary.counts.probe_needed, 0);
}

function assertSearchAndDescribe(): void {
  const entries = decodeOrThrow(searchView, payloadOf(callTool("ae_search_native_operations", { query: "render" }, {}))).entries;
  assert.ok(entries.some((entry) => entry.id === "render.add-to-queue"));
  assert.equal(entries.some((entry) => entry.inputSchema !== undefined), false);
  const entry = decodeOrThrow(describedView, payloadOf(callTool("ae_describe_native_operation", { id: "text.set-document", detail: "full" }, {})));
  assert.equal(entry.implementationStatus, "implemented");
  assert.equal(entry.schemaVersion, "0.1");
  assert.equal(entry.planType, "set_text_document");
  assert.deepEqual(entry.inputSchema.required, ["target"]);
  assert.ok(entry.inputSchema.properties.fillColor);
  assert.ok(entry.inputSchema.properties.target);
  assert.match(entry.planShape, /set_text_document/);
}

function assertProposalSchemaRequiresType(): void {
  const proposalTool = listTools().find((tool) => tool.name === "ae_propose_plan");
  const items = objectAt(objectAt(objectAt(jsonFieldsOf(proposalTool?.inputSchema), "properties"), "operations"), "items");
  assert.deepEqual(stringsIn(arrayAt(items, "required")), ["type"]);
  assert.ok(objectAt(items, "properties")?.target);
}

test("native operation registry reports complete domain coverage without a snapshot", () => {
  assertRegistryListsCoverage();
  assertSearchAndDescribe();
  assertProposalSchemaRequiresType();
});

function fixtureSnapshot(): ProjectSnapshot {
  return { ...representativeSnapshot, items: [
    { id: "folder-root", name: "Root", type: "folder", parentFolderId: null, compositionId: null, sourceId: null },
    { id: "folder-delete", name: "Delete", type: "folder", parentFolderId: null, compositionId: null, sourceId: null },
    { id: "footage-plate", name: "Plate", type: "footage", parentFolderId: "folder-root", compositionId: null, sourceId: null },
  ] };
}

function presetProfile(): HostCapabilityProfile {
  const inventory = makeInventory(HOST, [installed("ADBE Gaussian Blur 2")]);
  return makeHostProfile(inventory, undefined, makePresetInventory([{ id: "0123456789abcdef0123", root: "ae-presets", name: "Fade In", category: "Transitions", statFingerprint: "fixture" }]));
}

function assertFixtureReachesCompiler(id: string, snapshot: ProjectSnapshot, hostProfile: HostCapabilityProfile): void {
  const fixture = proposalFixtures()[id];
  assert.ok(fixture, `Missing proposal fixture for ${id}`);
  const plans = new Map<string, StoredPlan>();
  const proposed = callTool("ae_propose_plan", fixture, { snapshot, plans, hostProfile });
  assert.equal(proposed.ok, true, `${id} must be accepted by ae_propose_plan: ${JSON.stringify(proposed)}`);
  const record = plans.get(stringAt(resultData(proposed), "planId") ?? "");
  assert.ok(record, `${id} stores its plan`);
  assert.equal(validateActionPlan(record.plan, snapshot).ok, true, `${id} must remain a valid action plan`);
  assert.equal("operations" in compiledPlan(record), true, `${id} must compile for the fixed host adapter`);
}

test("every implemented registry operation has an explicit MCP proposal fixture that reaches the host compiler", () => {
  const implemented = NATIVE_OPERATION_REGISTRY.filter((entry) => entry.implementationStatus === "implemented").map((entry) => entry.id);
  assert.deepEqual(Object.keys(proposalFixtures()).sort(), [...implemented].sort());
  const snapshot = fixtureSnapshot();
  const hostProfile = presetProfile();
  for (const id of implemented) assertFixtureReachesCompiler(id, snapshot, hostProfile);
});

test("an operation with no evidence on this host is silent and needs no acknowledgement (deliberate: absence of evidence is not shown)", () => {
  const operations = [{ type: "add_marker", target: firstLayerTarget(), time: 0, comment: "x" }];
  const result = callTool("ae_propose_plan", { summary: "One marker", operations }, { snapshot: representativeSnapshot, plans: new Map(), hostKey: "26.2.1-2-macOS-arm64" });
  assert.equal(result.ok, true, JSON.stringify(result));
  const { presentation } = decodeOrThrow(presentationView, payloadOf(result));
  assert.equal(presentation.notices.some((notice) => notice.code === "UNVERIFIED_OPERATION"), false, "no never-tested notice exists any more");
  assert.equal(presentation.notices.some((notice) => notice.severity === "unverified" || notice.severity === "error"), false, "nothing here is broken or in doubt");
  assert.equal(presentation.verification.requiresAcknowledgement, false);
});

test("an unfinished effect scan reports unknown instead of not-installed, and a finished one reports the truth", () => {
  const target = firstLayerTarget();
  const ramp: JsonObject = { type: "ensure_effect", target: { ...target, effectPath: "ADBE Effect Parade/ADBE Ramp" }, capabilityId: "adobe.ramp", effectMatchName: "ADBE Ramp", effectPath: "ADBE Effect Parade/ADBE Ramp" };
  const propose = (profile: HostCapabilityProfile): ReturnType<typeof callTool> => callTool("ae_propose_plan", { summary: "Add a ramp", operations: [ramp] }, { snapshot: representativeSnapshot, plans: new Map(), hostProfile: profile });
  const partial = propose(makeHostProfile(makeInventory(HOST, [installed("ADBE Gaussian Blur 2")], true)));
  assert.equal(partial.ok, true, `an unfinished scan must not turn silence into a refusal: ${JSON.stringify(partial)}`);
  const notices = decodeOrThrow(presentationView, payloadOf(partial)).presentation.notices;
  assert.equal(notices.find((notice) => notice.code === "EFFECT_UNCONFIRMED"), undefined, "an unfinished scan adds no notice any more");
  const complete = propose(makeHostProfile(makeInventory(HOST, [installed("ADBE Gaussian Blur 2")])));
  assert.equal(refusalOf(complete).code, "EFFECT_NOT_INSTALLED", "a complete scan that lacks the effect is still refused");
  const present = propose(makeHostProfile(makeInventory(HOST, [installed("ADBE Ramp")])));
  assert.equal(present.ok, true, JSON.stringify(present));
});

function effectControlFixture(): { bundled: ReturnType<typeof loadFixtureEffectEvidence>; layer: JsonObject; blur: JsonObject; ensureBlur: JsonObject; context: { snapshot: ProjectSnapshot; hostProfile: HostCapabilityProfile; panelSessionId: string; plans: Map<string, StoredPlan> } } {
  const bundled = loadFixtureEffectEvidence();
  const merged = mergeEffectControlEvidence(bundled, { effects: {} });
  assert.ok(merged, "the fixture evidence merges");
  const hostProfile = applyEffectControlEvidence(makeHostProfile(makeInventory(HOST, [installed("ADBE Gaussian Blur 2"), installed("ADBE Glo2"), installed("CC Light Rays")])), merged);
  const layer = { compositionId: "comp-main", layerId: "layer-title" };
  const blur = { ...layer, effectPath: BLUR_PATH };
  const ensureBlur = { type: "ensure_effect", target: blur, capabilityId: "adobe.gaussian-blur", effectMatchName: "ADBE Gaussian Blur 2", effectPath: BLUR_PATH };
  return { bundled, layer, blur, ensureBlur, context: { snapshot: representativeSnapshot, hostProfile, panelSessionId: "panel-test", plans: new Map<string, StoredPlan>() } };
}

test("effect control schemas: fixture evidence pages controls and derived write shapes", () => {
  const { bundled, context } = effectControlFixture();
  assert.ok(bundled && Object.keys(bundled.effects).length > 390, "the fixture carries host built-in effect schemas");
  assert.equal(Object.keys(bundled.effects).some((matchName) => matchName.startsWith("Pseudo/")), false, "preset pseudo-effects are not in the fixture");
  const described = decodeOrThrow(controlsView, payloadOf(callTool("ae_describe_host_capability", { id: "host:CC Light Rays", detail: "controls" }, context)));
  assert.ok(described.items.length > 3 && described.items.every((control) => control.path.startsWith("CC Light Rays/")), "an uncurated installed effect now has a probed control schema");
  const writeShapes = described.writeShapes ?? [];
  assert.ok(writeShapes.length > 3, "every described control set carries derived write lines");
  assert.ok(writeShapes.every((line) => line.length > 0), "no empty write lines");
  assert.ok(writeShapes.some((line) => /one number/.test(line)), "a scalar control is described as taking one number");
  assert.ok(writeShapes.some((line) => /two numbers/.test(line)), "a 2D control is described as taking two numbers");
});

function assertBlurValuesAreChecked(): void {
  const { blur, ensureBlur, context } = effectControlFixture();
  const setBlur = (control: string, value: JsonValue): ReturnType<typeof callTool> => callTool("ae_propose_plan", { summary: "Blur value", operations: [ensureBlur, { type: "set_effect_control", target: { ...blur, propertyPath: `${BLUR_PATH}/${control}` }, effectMatchName: "ADBE Gaussian Blur 2", value }] }, context);
  assert.match(refusalOf(setBlur("ADBE Gaussian Blur 2-0002", 99)).message, /Blur Dimensions accepts 1-3 \(got 99\)/);
  assert.equal(setBlur("ADBE Gaussian Blur 2-0002", 2).ok, true);
  assert.match(refusalOf(setBlur("ADBE Gaussian Blur 2-0001", [1, 2])).message, /takes one number/);
}

function assertEffectIdentityIsChecked(): void {
  const { layer, context } = effectControlFixture();
  const glow = { ...layer, effectPath: GLOW_PATH };
  const ensureGlow = { type: "ensure_effect", target: glow, capabilityId: "host:ADBE Glo2", effectMatchName: "ADBE Glo2", effectPath: GLOW_PATH };
  const glowColor = callTool("ae_propose_plan", { summary: "Glow color", operations: [ensureGlow, { type: "set_effect_control", target: { ...glow, propertyPath: `${GLOW_PATH}/ADBE Glo2-0012` }, effectMatchName: "ADBE Glo2", value: [1, 2, 0] }] }, context);
  assert.match(refusalOf(glowColor).message, /is a color/);
  const missing = { type: "ensure_effect", target: { ...layer, effectPath: "ADBE Effect Parade/ACME Nope" }, capabilityId: "host:ACME Nope", effectMatchName: "ACME Nope", effectPath: "ADBE Effect Parade/ACME Nope" };
  assert.equal(refusalOf(callTool("ae_propose_plan", { summary: "Missing", operations: [missing] }, context)).code, "EFFECT_NOT_INSTALLED");
  const mismatched = { ...ensureGlow, capabilityId: "host:ADBE Gaussian Blur 2" };
  assert.equal(callTool("ae_propose_plan", { summary: "Mismatch", operations: [mismatched] }, context).ok, false);
}

function assertLayerStylesAreChecked(): void {
  const { layer, context } = effectControlFixture();
  const style = (values: JsonObject, styleName = "drop-shadow"): ReturnType<typeof callTool> => callTool("ae_propose_plan", { summary: "Shadow", operations: [{ type: "ensure_layer_style", target: layer, style: styleName, values }] }, context);
  assert.equal(style({ "dropShadow/distance": 12, "dropShadow/color": [0, 0, 0] }).ok, true);
  assert.match(refusalOf(style({ "frameFX/size": 3 })).message, /starting with "dropShadow\/"/);
  assert.match(refusalOf(style({}, "pattern-overlay")).message, /drop-shadow.*stroke/);
}

test("effect control static values, menus and colors are checked against the bundled schema before approval", () => {
  assertBlurValuesAreChecked();
  assertEffectIdentityIsChecked();
  assertLayerStylesAreChecked();
});

function effectControlRows(snapshot: ProjectSnapshot, limit: number): { count: number; truncated: boolean | undefined } {
  const result = callTool("ae_get_effect_controls", { matchName: "ADBE Gaussian Blur 2", limit }, { snapshot });
  return { count: rowsOf(result).length, truncated: result.ok ? result.truncated : undefined };
}

test("ae_get_effect_controls reports truncated only when matches exceed the effective limit", () => {
  const single = effectControlRows(representativeSnapshot, 1);
  assert.equal(single.count, 1);
  assert.notEqual(single.truncated, true, "one match at limit 1 is complete");
  const composition = representativeSnapshot.compositions[0];
  const first = composition?.layers[0];
  assert.ok(composition && first);
  const twoBlurs = { ...representativeSnapshot, compositions: representativeSnapshot.compositions.map((candidate) => (candidate.id === composition.id ? { ...candidate, layers: [...candidate.layers, { ...first, id: "layer-title-copy", index: 9 }] } : candidate)) };
  const capped = effectControlRows(twoBlurs, 1);
  assert.equal(capped.count, 1);
  assert.equal(capped.truncated, true, "two matches at limit 1 are truncated");
  const exact = effectControlRows(twoBlurs, 2);
  assert.equal(exact.count, 2);
  assert.notEqual(exact.truncated, true, "two matches at limit 2 are complete");
});

test("export_mogrt proposals judge a Windows drive path by the OS-local policy, not by the action-plan shape check", () => {
  const propose = (outputPath: string): ReturnType<typeof callTool> => callTool("ae_propose_plan", { summary: "Export", operations: [{ type: "export_mogrt", target: { compositionId: "comp-main" }, templateName: "T", outputPath, exportAuthorization: "EXPORT_NOW" }] }, { snapshot: representativeSnapshot, plans: new Map() });
  for (const outputPath of ["C:/Users/x/supplement.mogrt", "C:\\Users\\x\\a.mogrt"]) {
    const proposed = propose(outputPath);
    assert.doesNotMatch(proposed.ok ? "" : proposed.error.message, /ending in \.mogrt/, `${outputPath} must not fail the shape check`);
  }
  assert.equal(propose("templates/t.mogrt").ok, false, "a relative path is refused");
});

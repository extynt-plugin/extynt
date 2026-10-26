// Proves composition and layer inspection answer chat-sized pages with cursors, group and fold properties, refuse unknown or unread targets, and mark opaque controls.
import test from "node:test";
import assert from "node:assert/strict";
import { array, boolean, jsonValue, number, object, optional, record, string } from "@extynt/decode";
import { representativeSnapshot } from "@extynt/project-graph";
import type { Infer, JsonObject, JsonValue } from "@extynt/decode";
import type { CompositionSnapshot, LayerSnapshot, ProjectSnapshot, PropertySnapshot } from "@extynt/project-graph";
import { callTool } from "../src/index.js";
import { asObject, booleanAt } from "../src/json.js";
import { payloadOf, refusalOf } from "./support/json-results.js";
import { baseLayer, objectPath, successView } from "./support/protocol-views.js";
import type { ToolOutcome } from "./support/protocol-views.js";
import { queueContext } from "./support/queue-context.js";

const compositionPage = object({ layerCount: number(), layers: array(record(string(), jsonValue)), nextCursor: optional(string()) });
const layerPage = object({ totalProperties: number(), matchedProperties: number(), omitted: optional(record(string(), number())), properties: record(string(), record(string(), jsonValue)), nextCursor: optional(string()) });
const issueRows = array(object({ code: string(), layerId: optional(string()), severity: string(), animated: optional(boolean()) }));
const fixRows = object({ fix: array(object({ code: string(), message: string(), instruction: string() })) });

function leaf(path: string, value: PropertySnapshot["value"], extra: Partial<PropertySnapshot> = {}): PropertySnapshot {
  return { path, matchName: path.split("/").at(-1) ?? path, displayName: path, kind: "property", valueType: "vector", value, canSetValue: true, ...extra };
}

function snapshotOf(base: ProjectSnapshot, composition: CompositionSnapshot, layers: LayerSnapshot[]): ProjectSnapshot {
  return { ...base, compositions: [{ ...composition, layers }] };
}

function heavyTextSnapshot(fingerprint = "fp-heavy"): ProjectSnapshot {
  const animators = Array.from({ length: 169 }, (_, i): PropertySnapshot => leaf(`ADBE Text Properties/ADBE Text Animators/ADBE Text Animator/ADBE Text Animator Properties/ADBE Text Prop ${i}`, [0, 0, 0], { displayName: `Animator Property ${i}`, canSetValue: i % 3 !== 0 }));
  const reversePath = leaf("ADBE Text Properties/ADBE Text Path Options/ADBE Text Reverse Path", [0], { displayName: "Reverse Path", valueType: "number", canSetValue: false });
  const transform: PropertySnapshot[] = [
    { path: "ADBE Transform Group", matchName: "ADBE Transform Group", displayName: "Transform", kind: "group", valueType: "unknown", value: null, canSetValue: false },
    leaf("ADBE Transform Group/ADBE Position", [320, 180], { displayName: "Position", keyframeCount: 2 }),
  ];
  const { composition, layer } = baseLayer();
  const layers = Array.from({ length: 10 }, (_, i): LayerSnapshot => ({ ...layer, id: `text-${i}`, index: i + 1, name: `TYPE ${i}`, isSelected: false, properties: [...transform, ...animators, reversePath] }));
  return { ...snapshotOf(representativeSnapshot, { ...composition, id: "67", name: "Codex Type Animation E2E" }, layers), fingerprint };
}

function inspectComposition(snapshot: ProjectSnapshot, args: JsonObject): ToolOutcome {
  return callTool("ae_inspect_composition", { compositionId: "67", ...args }, { snapshot });
}

function pagedLayerIds(snapshot: ProjectSnapshot): string[] {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page: Infer<typeof compositionPage> = successView(compositionPage, inspectComposition(snapshot, { maxBytes: 4000, limit: 3, ...(cursor ? { cursor } : {}) }));
    ids.push(...page.layers.map((row) => String(row.id)));
    cursor = page.nextCursor;
  } while (cursor);
  return ids;
}

test("ae_inspect_composition returns a chat-sized per-layer summary with a page cursor", () => {
  const snapshot = heavyTextSnapshot();
  const firstResult = inspectComposition(snapshot, { maxBytes: 4000, limit: 3 });
  assert.ok(Buffer.byteLength(JSON.stringify(firstResult)) <= 4000 + 1024);
  const first = successView(compositionPage, firstResult);
  assert.equal(first.layerCount, 10);
  assert.ok(first.layers.length > 0 && first.layers.length < 10);
  assert.ok(first.nextCursor);
  const layer = first.layers[0];
  assert.equal(layer && "properties" in layer, false);
  assert.deepEqual(layer?.transform, { Position: [320, 180] });
  assert.deepEqual(layer?.animated, [{ path: "ADBE Transform Group/ADBE Position", keyframes: 2 }]);
  const ids = pagedLayerIds(snapshot);
  assert.equal(ids.length, 10);
  assert.equal(new Set(ids).size, 10);
  const full = inspectComposition(snapshot, {});
  assert.ok(Buffer.byteLength(JSON.stringify(full)) < 8000);
  assert.equal(successView(compositionPage, full).layers.length, 10);
  const stale = callTool("ae_inspect_composition", { compositionId: "67", cursor: first.nextCursor }, { snapshot: heavyTextSnapshot("fp-changed") });
  assert.equal(refusalOf(stale).code, "STALE_CURSOR");
});

function leavesOf(page: Infer<typeof layerPage>): Array<{ path: string; cell: JsonValue }> {
  return Object.entries(page.properties).flatMap(([group, cells]) => Object.entries(cells).filter(([name]) => name !== "@").map(([name, cell]) => ({ path: group ? `${group}/${name}` : name, cell })));
}

function inspectLayer(snapshot: ProjectSnapshot, args: JsonObject): ToolOutcome {
  return callTool("ae_inspect_layer", { compositionId: "67", layerId: "text-0", ...args }, { snapshot });
}

function noisySnapshot(snapshot: ProjectSnapshot): ProjectSnapshot {
  const { composition, layer } = baseLayer(snapshot);
  const materials = Array.from({ length: 30 }, (_, i) => leaf(`ADBE Material Options Group/ADBE Mat ${i}`, 1, { displayName: `Mat ${i}`, valueType: "number" }));
  return snapshotOf(snapshot, composition, [{ ...layer, properties: [...layer.properties, ...materials] }]);
}

function assertEditableCellsAreGrouped(snapshot: ProjectSnapshot): void {
  const data = successView(layerPage, inspectLayer(snapshot, { include: "editable", limit: 500, maxBytes: 64000 }));
  assert.equal(data.totalProperties, 172);
  assert.equal(data.matchedProperties, 113);
  assert.equal(leavesOf(data).length, 113);
  assert.equal(leavesOf(data).some((row) => row.path.endsWith("ADBE Text Reverse Path")), false);
  assert.deepEqual(data.properties["ADBE Transform Group"]?.["ADBE Position"], { value: [320, 180], keyframes: 2 });
  const all = successView(layerPage, inspectLayer(snapshot, { include: "all", pathPrefix: "ADBE Text Properties/ADBE Text Path Options" }));
  assert.deepEqual(leavesOf(all).map((row) => row.path), ["ADBE Text Properties/ADBE Text Path Options/ADBE Text Reverse Path"]);
  assert.equal(booleanAt(asObject(leavesOf(all)[0]?.cell), "readOnly"), true);
}

function assertPagingIsScopedToTheLayer(snapshot: ProjectSnapshot): void {
  const paged = inspectLayer(snapshot, { maxBytes: 4000 });
  const cursor = successView(layerPage, paged).nextCursor;
  assert.ok(cursor);
  assert.ok(Buffer.byteLength(JSON.stringify(paged)) <= 5024);
  assert.equal(inspectLayer(snapshot, { layerId: "text-1", cursor }).ok, false);
}

function assertNoiseGroupsAreFolded(snapshot: ProjectSnapshot): void {
  const noisy = noisySnapshot(snapshot);
  const core = successView(layerPage, inspectLayer(noisy, { limit: 500, maxBytes: 64000 }));
  assert.deepEqual(core.omitted, { "ADBE Material Options Group": 30 });
  assert.equal(core.matchedProperties, 113);
  const drilled = successView(layerPage, inspectLayer(noisy, { pathPrefix: "ADBE Material Options Group" }));
  assert.equal(drilled.matchedProperties, 30, "omitted groups stay reachable by pathPrefix");
}

test("ae_inspect_layer groups cells by path, folds noise groups, and filters by path prefix", () => {
  const snapshot = heavyTextSnapshot();
  assertEditableCellsAreGrouped(snapshot);
  assertPagingIsScopedToTheLayer(snapshot);
  assertNoiseGroupsAreFolded(snapshot);
});

function issueLayer(id: string, name: string, properties: PropertySnapshot[], extra: Partial<LayerSnapshot> = {}): LayerSnapshot {
  const { layer } = baseLayer();
  return { ...layer, id, index: Number(id.replace(/\D/g, "")) || 1, name, type: "text", enabled: true, shy: false, solo: false, locked: false, startTime: 0, inPoint: 0, outPoint: 6, stretch: 100, parentId: null, matteLayerId: null, matteType: "none", isSelected: false, sourceId: null, properties, ...extra };
}

function placement(path: string, value: PropertySnapshot["value"], keyframeCount = 0): PropertySnapshot {
  return leaf(path, value, { displayName: path, expression: null, expressionEnabled: false, ...(keyframeCount ? { keyframeCount } : {}) });
}

test("project issues flag superseded names and layers invisible or off-canvas at the current time", () => {
  const { composition } = baseLayer();
  const snapshot = snapshotOf(representativeSnapshot, { ...composition, id: "comp-issues", width: 1920, height: 1080 }, [
    issueLayer("l1", "TYPE — MOVE", [placement("ADBE Transform Group/ADBE Position", [960, 540])]),
    issueLayer("l2", "TYPE — MOVE POINT", [placement("ADBE Transform Group/ADBE Position", [2500, 780], 2)]),
    issueLayer("l3", "FORM — O", [placement("ADBE Transform Group/ADBE Scale", [0, 0, 100])]),
    issueLayer("l4", "Hidden", [placement("ADBE Transform Group/ADBE Position", [-500, 300])], { enabled: false }),
  ]);
  const issues = successView(issueRows, callTool("ae_list_project_issues", { compositionId: "comp-issues" }, { snapshot }));
  assert.ok(issues.some((issue) => issue.code === "SUPERSEDED_LAYER_CANDIDATE" && issue.layerId === "l1"));
  const offCanvas = issues.find((issue) => issue.code === "OFF_CANVAS_AT_CURRENT_TIME");
  assert.equal(offCanvas?.layerId, "l2");
  assert.equal(offCanvas?.animated, true);
  assert.equal(offCanvas?.severity, "info");
  assert.ok(issues.some((issue) => issue.code === "ZERO_SCALE_AT_CURRENT_TIME" && issue.layerId === "l3" && issue.severity === "warning"));
  assert.equal(issues.some((issue) => issue.layerId === "l4"), false, "disabled layers are not layout risks");
});

test("ae_list_project_issues refuses an unknown compositionId instead of answering an empty issue list", () => {
  const snapshot = representativeSnapshot;
  const unknown = refusalOf(callTool("ae_list_project_issues", { compositionId: "does-not-exist" }, { snapshot }));
  assert.equal(unknown.code, "COMPOSITION_NOT_FOUND", "an unknown composition is a wrong argument, not a clean composition");
  assert.match(unknown.message, /does-not-exist/);
  assert.equal(refusalOf(callTool("ae_list_effects_and_expressions", { compositionId: "does-not-exist" }, { snapshot })).code, "COMPOSITION_NOT_FOUND");
  assert.equal(callTool("ae_list_project_issues", { compositionId: "comp-main" }, { snapshot }).ok, true);
  assert.equal(callTool("ae_list_project_issues", {}, { snapshot }).ok, true);
  assert.equal(refusalOf(callTool("ae_list_project_issues", { compositionId: 42 }, { snapshot })).code, "INVALID_ARGUMENT");
});

test("a field the operation does not take is refused with the fields it does", () => {
  const operation: JsonObject = { type: "add_marker", target: { compositionId: "comp-main", layerId: "layer-title" }, time: 1, comment: "x", bogusField: true };
  const refused = callTool("ae_queue_add", { operations: [operation] }, queueContext());
  const fix = successView(fixRows, refused).fix[0];
  assert.ok(fix, "the queue answers with a fix");
  assert.equal(fix.code, "UNKNOWN_FIELD");
  for (const field of ["time", "target", "comment"]) assert.match(fix.message, new RegExp(`\\b${field}\\b`), `the refusal names ${field}`);
  assert.match(fix.message, /accepts at the top level/i, "the refusal says it is listing the fields it accepts");
  assert.match(fix.instruction, /message lists every field/i, "the fix sends the reader to the list it can trust");
  assert.doesNotMatch(fix.instruction, /bogusField/, "and does not simply echo the field that was wrong");
});

test("the open composition that the snapshot has not read is reported as unread, never as absent from the project", () => {
  const snapshot = { ...representativeSnapshot, activeCompositionId: "229", fingerprint: "fp-unread" };
  for (const tool of ["ae_inspect_composition", "ae_inspect_layer"]) {
    const refusal = refusalOf(callTool(tool, { compositionId: "229", layerId: "l1" }, { snapshot }));
    assert.equal(refusal.code, "COMPOSITION_NOT_FOUND");
    assert.match(refusal.message, /Composition 229 is open in After Effects but has not been read yet/);
    assert.match(refusal.message, /ae_refresh_snapshot/);
    assert.doesNotMatch(refusal.message, /No composition 229 in this project/);
  }
  const other = refusalOf(callTool("ae_inspect_composition", { compositionId: "230" }, { snapshot }));
  assert.match(other.message, /No composition 230 in this project\. The active composition is 229/);
});

test("a control with no scriptable value is marked opaque so its label is never read as its setting", () => {
  const { composition, layer } = baseLayer();
  const group = "ADBE Effect Parade/ADBE Apply Color LUT2";
  const lut: PropertySnapshot[] = [
    { path: group, matchName: "ADBE Apply Color LUT2", displayName: "Apply Color LUT", kind: "group", valueType: "unknown", value: null, canSetValue: false },
    leaf(`${group}/ADBE Apply Color LUT2-0001`, null, { displayName: "<LUT not set>", valueType: "unknown", canSetValue: false, animatable: false }),
  ];
  const lutSnapshot = snapshotOf(representativeSnapshot, { ...composition, id: "9" }, [{ ...layer, id: "g", properties: lut }]);
  const read = payloadOf(callTool("ae_inspect_layer", { compositionId: "9", layerId: "g", include: "all", pathPrefix: "ADBE Effect Parade" }, { snapshot: lutSnapshot }));
  assert.match(String(objectPath(read, ["properties", group, "ADBE Apply Color LUT2-0001"])?.opaque), /name is a label, not the setting/);
  const marker = leaf("ADBE Marker", { count: 0, markers: [] }, { displayName: "Marker", valueType: "unknown", canSetValue: false });
  const markerSnapshot = snapshotOf(representativeSnapshot, { ...composition, id: "9" }, [{ ...layer, id: "g", properties: [marker] }]);
  const markers = callTool("ae_inspect_layer", { compositionId: "9", layerId: "g", include: "all" }, { snapshot: markerSnapshot });
  assert.doesNotMatch(JSON.stringify(markers), /opaque/, "a layer stream is never opaque");
});

// Proves native-operation discovery: every plan type describes its own plan shape, multi-entry types name their siblings, summaries are compact, and the searchable list ranks well.
import test from "node:test";
import assert from "node:assert/strict";
import { array, jsonValue, number, object, optional, record, string } from "@extynt/decode";
import { executablePlanTypes, NATIVE_OPERATION_REGISTRY } from "@extynt/capability-catalogue";
import { callTool, operationReference } from "../src/index.js";
import { arrayAt, asObject, booleanAt, objectsIn, stringAt } from "../src/json.js";
import type { JsonObject } from "@extynt/decode";
import { payloadOf } from "./support/json-results.js";
import { successView } from "./support/protocol-views.js";

const inputSchema = object({ required: array(string()), properties: record(string(), jsonValue) });
const coverage = object({ planType: string(), servedBy: number(), described: string(), others: array(object({ id: string(), description: string() })), next: string() });
const entryView = object({ id: optional(string()), planType: string(), planShape: optional(string()), inputSchema, planTypeCoverage: optional(coverage) });

function describeEntry(id: string) {
  return successView(entryView, callTool("ae_describe_native_operation", { id, detail: "full" }, {}));
}

function targetDescription(id: string): string | undefined {
  return stringAt(asObject(describeEntry(id).inputSchema.properties.target), "description");
}

function planTypeProblems(planType: string): string[] {
  const described = callTool("ae_describe_native_operation", { id: planType, detail: "full" }, {});
  if (!described.ok) return [`${planType}: describe failed`];
  const entry = successView(entryView, described);
  return [
    entry.planType === planType ? "" : `${planType}: described as ${entry.planType}`,
    entry.planShape ? "" : `${planType}: no planShape`,
    "action" in entry.inputSchema.properties || entry.inputSchema.required.includes("action") ? `${planType}: advertises the capability discriminator action` : "",
    entry.inputSchema.required.filter((key) => key === "target").length > 1 ? `${planType}: target listed twice in required` : "",
  ].filter((problem) => problem !== "");
}

test("every plan type describes its own plan shape, and none advertises a capability discriminator", () => {
  assert.deepEqual(executablePlanTypes().flatMap(planTypeProblems), []);
});

test("a capability that backs several plan operations describes only the one asked about", () => {
  const add = describeEntry("add_marker");
  assert.deepEqual(add.inputSchema.required, ["time", "target"]);
  assert.ok(add.inputSchema.properties.comment, "add_marker carries the marker value fields");
  assert.equal(add.inputSchema.properties.destructive, undefined, "remove_marker's destructive flag is not offered on add_marker");
  const remove = describeEntry("remove_marker");
  assert.deepEqual(remove.inputSchema.required, ["time", "destructive", "target"]);
  assert.equal(remove.inputSchema.properties.comment, undefined, "add_marker's fields are not offered on remove_marker");
  assert.ok(describeEntry("add_mask").inputSchema.properties.newMaskId);
  assert.equal(describeEntry("add_mask").inputSchema.properties.maskId, undefined, "update/remove's maskId is not offered on add_mask");
  assert.ok(describeEntry("remove_mask").inputSchema.properties.destructive);
  assert.equal(describeEntry("create_composition").inputSchema.properties.target, undefined, "create_composition takes no target");
  assert.equal(describeEntry("render_composition").inputSchema.properties.target, undefined, "render_composition names its composition directly and takes no target");
  assert.ok(describeEntry("set_composition_guides").inputSchema.properties.target, "set_composition_guides does take a target");
});

test("each path is placed where its plan puts it", () => {
  assert.equal(describeEntry("add_essential_property").inputSchema.properties.propertyPath, undefined, "add_essential_property takes propertyPath inside target");
  assert.match(targetDescription("add_essential_property") ?? "", /propertyPath/);
  assert.ok(describeEntry("set_layer_property").inputSchema.properties.propertyPath, "set_layer_property takes propertyPath at the top level");
  assert.doesNotMatch(targetDescription("set_layer_property") ?? "", /propertyPath/);
  assert.ok(describeEntry("ensure_effect").inputSchema.properties.effectPath);
  assert.match(targetDescription("ensure_effect") ?? "", /effectPath/);
  assert.match(describeEntry("ensure_effect").planShape ?? "", /must appear in both places/);
  assert.match(targetDescription("ensure_effect") ?? "", /must also appear at the top level/);
});

function assertCoverageNamesOtherEntries(): void {
  const described = describeEntry("add_shape_item");
  assert.equal(described.id, "shape.primitive");
  assert.equal(described.planType, "add_shape_item");
  assert.ok(described.inputSchema.properties.item, "the primary entry is still described in full");
  const named = described.planTypeCoverage;
  assert.ok(named, "the plan type reports its coverage");
  assert.equal(named.planType, "add_shape_item");
  assert.equal(named.servedBy, 3);
  assert.equal(named.described, "shape.primitive");
  assert.deepEqual(named.others.map((entry) => entry.id), ["shape.gradient", "shape.operator"]);
  for (const sibling of named.others) assert.ok(sibling.description.length > 0, `${sibling.id} is named with what it does`);
  assert.match(named.next, /served by 3 registry entries/);
}

test("describing a plan type names every registry entry that serves it instead of returning one silently", () => {
  assertCoverageNamesOtherEntries();
  for (const [planType, others] of [["update_shape_item", ["shape.gradient", "shape.operator"]], ["animate_property", ["text.animate-selector"]], ["create_layer", ["layer.add-source"]], ["render_composition", ["render.configure", "render.output-settings", "render.send-to-media-encoder", "render.execute"]]] as const) {
    assert.deepEqual(describeEntry(planType).planTypeCoverage?.others.map((entry) => entry.id), others, `${planType} names its other entries`);
  }
  assert.equal(describeEntry("set_text_document").planTypeCoverage, undefined);
  assert.equal(describeEntry("shape.gradient").planTypeCoverage, undefined);
});

test("native operation discovery is summary-first and full-detail only by explicit request", () => {
  const compact = payloadOf(callTool("ae_describe_native_operation", { id: "animate_property" }, {}));
  const complete = payloadOf(callTool("ae_describe_native_operation", { id: "animate_property", detail: "full" }, {}));
  for (const key of ["provenance", "hostVersionGate", "verificationBasis"]) assert.equal(key in compact, false);
  assert.ok(compact.inputSchema);
  assert.equal("planShape" in compact, false, "the plan-shape boilerplate lives once in the build kit");
  for (const key of ["verification", "runtimeEvidence", "planTypeCoverage", "next"]) assert.equal(key in compact, false, `${key} is audit detail`);
  for (const key of ["provenance", "hostVersionGate", "verificationBasis"]) assert.notEqual(complete[key], undefined);
  assert.notDeepEqual(compact, complete);
});

test("the field reference lists every plan type the registry implements, merged across entries", () => {
  const reference = operationReference();
  const shape = reference.lines.filter((line) => line.startsWith("add_shape_item") || line.startsWith("update_shape_item"));
  assert.equal(shape.length, 2, "both shape-item plan types are listed");
  for (const line of shape) for (const kind of ["rectangle", "ellipse", "star", "gradient-fill", "gradient-stroke", "repeater", "trim-paths"]) {
    assert.match(line, new RegExp(kind), `${kind} must be listed in: ${line}`);
  }
  const implemented = new Set(NATIVE_OPERATION_REGISTRY.filter((entry) => entry.implementationStatus === "implemented").flatMap((entry) => entry.planTypes));
  const listed = new Set(reference.lines.map((line) => line.split(" — ")[0]));
  assert.deepEqual([...implemented].filter((planType) => !listed.has(planType)), [], "no implemented plan type may be missing from the reference");
  const update = reference.lines.find((line) => line.startsWith("update_shape_item")) ?? "";
  assert.match(update, /required: [^—]*itemId/, `an update addresses the item it changes: ${update}`);
  assert.doesNotMatch(update, /newItemId/, "and mints nothing");
  const add = reference.lines.find((line) => line.startsWith("add_shape_item")) ?? "";
  assert.doesNotMatch(add, /itemId=/, "an add mints a name instead");
  assert.match(add, /newItemId/);
});

function describeOperations(id: string | string[]): ReadonlyArray<JsonObject> {
  return objectsIn(arrayAt(payloadOf(callTool("ae_describe_native_operation", { id }, {})), "operations"));
}

test("the describe summary is id, planType, status, schema and example", () => {
  const one = payloadOf(callTool("ae_describe_native_operation", { id: "add_shape_item" }, {}));
  assert.deepEqual(Object.keys(one).filter((key) => key !== "planExample"), ["id", "planType", "status", "inputSchema", "otherEntries"]);
  assert.equal(typeof one.status, "string");
  assert.deepEqual(one.otherEntries, ["shape.gradient", "shape.operator"]);
  const full = payloadOf(callTool("ae_describe_native_operation", { id: "animate_property", detail: "full" }, {}));
  const summary = payloadOf(callTool("ae_describe_native_operation", { id: "animate_property" }, {}));
  assert.ok(JSON.stringify(summary).length < JSON.stringify(full).length, "the summary is smaller than the full entry");
});

test("several ids answer one entry each", () => {
  const ids = ["animate_property", "set_layer_property", "text.set-document", "no_such_operation_zz"];
  const operations = describeOperations(ids);
  assert.equal(operations.length, ids.length);
  assert.deepEqual(operations.slice(0, 3).map((entry) => stringAt(entry, "planType")), ["animate_property", "set_layer_property", "set_text_document"]);
  assert.equal(booleanAt(operations[3], "found"), false, "an unknown id gets its own not-found entry without failing the others");
  assert.equal(describeOperations(["animate_property"]).length, 1, "an array always answers an array");
  assert.equal(callTool("ae_describe_native_operation", { id: Array.from({ length: 13 }, () => "animate_property") }, {}).ok, false);
  assert.equal(callTool("ae_describe_native_operation", { id: [1] }, {}).ok, false);
});

function rank(query: string): ReadonlyArray<string | undefined> {
  return objectsIn(arrayAt(payloadOf(callTool("ae_search_native_operations", { query }, {})), "entries")).map((row) => stringAt(row, "planType"));
}

test("the searchable operation list: compact rows, the whole registry in one answer, best match first", () => {
  const data = payloadOf(callTool("ae_search_native_operations", { query: "" }, {}));
  const entries = objectsIn(arrayAt(data, "entries"));
  assert.equal(data.truncated, undefined, "every operation fits in one answer");
  assert.equal(entries.length, NATIVE_OPERATION_REGISTRY.length);
  assert.ok(entries.every((row) => (stringAt(row, "summary") ?? "").length > 0 && (stringAt(row, "summary") ?? "").length <= 100));
  assert.ok(JSON.stringify(data).length < 12288);
  assert.equal(rank("create_layer")[0], "create_layer", "an exact plan type name beats every description hit");
  const animate = rank("animate");
  assert.equal(animate.indexOf("animate_property") < animate.indexOf("set_layer_property") || !animate.includes("set_layer_property"), true);
  assert.equal(rank("keyframe text animate")[0] !== undefined, true, "several words never come back empty when any word matches");
});

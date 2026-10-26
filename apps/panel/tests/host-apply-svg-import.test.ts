/**
 * Apply-plan host contract: SVG import. The import type is chosen by canImportAs (COMP_CROPPED_LAYERS, then COMP, never
 * FOOTAGE) and a failure carries what the host answered.
 */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { loadApplyPlan } from "./host-apply-harness.js";
import { type PlanApply, applyPlan, assertApplied } from "./host-plan-io.js";
import { evaluateJson } from "./host-vm-context.js";
import { fieldOf, listAt, readJson, recordOf, textAt, textOf } from "./json-narrow.js";
import { type JsonObject } from "@extynt/decode";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>';
const SOURCE_HASH = "c".repeat(64);
const METADATA = { bytes: Buffer.byteLength(SVG), elements: 2, maxDepth: 1, pathCommands: 2, gradientStops: 0, gradients: 0, masks: 0, clipPaths: 0, sourceHash: SOURCE_HASH };
const IMPORT_OPERATION: JsonObject = {
  operation: "create_vector_artwork",
  newItemId: "__new__:vector",
  name: "Mark",
  svg: SVG,
  sourceHash: SOURCE_HASH,
  metadata: METADATA,
  importMode: "editable",
  managedSourcePolicy: "retain",
};
const AS_COMP = 'options.importAs = options.importAs === "composition-cropped-layers" ? "composition" : options.importAs; return __importFile(options);';
const PASS_THROUGH = "return __importFile(options);";

function plan(apply: PlanApply, planId: string): JsonObject {
  return applyPlan(apply, planId, [IMPORT_OPERATION]);
}

function hostWithImporter(canImportAs: string, importFile: string) {
  const loaded = loadApplyPlan();
  vm.runInContext(
    `var __asked = []; ImportOptions.prototype.canImportAs = function (type) { __asked.push(type); ${canImportAs} };
    var __importFile = app.project.importFile; app.project.importFile = function (options) { ${importFile} };`,
    loaded.context,
  );
  const asked = () => listAt(evaluateJson(loaded.context, "__asked")).map(textOf);
  return { ...loaded, asked };
}

function evidenceOf(result: JsonObject, code: string): JsonObject {
  assert.equal(fieldOf(result, "ok"), false);
  assert.equal(fieldOf(result, "error", "code"), code);
  return recordOf(readJson(textAt(result, "error", "message").slice(code.length + 2)));
}

test("SVG import uses COMP when COMP_CROPPED_LAYERS is refused, and never asks about FOOTAGE", () => {
  const { apply, asked } = hostWithImporter('return type === "composition";', AS_COMP);
  assertApplied(plan(apply, "svg-comp"));
  assert.deepEqual(asked(), ["composition-cropped-layers", "composition"]);
});

test("SVG import prefers COMP_CROPPED_LAYERS (Retain Layer Sizes), imports as it and stops asking once it is accepted", () => {
  const { apply, asked, context } = hostWithImporter("return true;", "globalThis.__importedAs = options.importAs; " + AS_COMP);
  assert.equal(fieldOf(plan(apply, "svg-cropped"), "ok"), true);
  assert.deepEqual(asked(), ["composition-cropped-layers"]);
  assert.equal(evaluateJson(context, "__importedAs"), "composition-cropped-layers");
});

test("a refused SVG import reports each canImportAs answer, the file and what the host exposes", () => {
  const { apply, asked } = hostWithImporter('if (type === "composition-cropped-layers") return false; throw new Error("not supported here");', PASS_THROUGH);
  const evidence = evidenceOf(plan(apply, "svg-refused"), "SVG_IMPORT_UNSUPPORTED");
  assert.deepEqual(fieldOf(evidence, "canImportAs"), { COMP_CROPPED_LAYERS: "false", COMP: "threw: not supported here" });
  assert.equal(fieldOf(evidence, "importOptions"), "function");
  assert.equal(fieldOf(evidence, "importAsType"), "object");
  assert.equal(fieldOf(evidence, "extension"), ".svg");
  assert.equal(typeof fieldOf(evidence, "length"), "number");
  assert.deepEqual(asked(), ["composition-cropped-layers", "composition"], "FOOTAGE is never a fallback");
});

test("an AE error that returns undefined from canImportAs is reported as undefined, not accepted", () => {
  const { apply } = hostWithImporter("return undefined;", PASS_THROUGH);
  const evidence = evidenceOf(plan(apply, "svg-undefined"), "SVG_IMPORT_UNSUPPORTED");
  assert.deepEqual(fieldOf(evidence, "canImportAs"), { COMP_CROPPED_LAYERS: "undefined", COMP: "undefined" });
});

test("an SVG import that throws or returns null is SVG_IMPORT_FAILED with the host's text", () => {
  const thrown = evidenceOf(plan(hostWithImporter("return true;", 'throw new Error("import exploded");').apply, "svg-threw"), "SVG_IMPORT_FAILED");
  assert.equal(fieldOf(thrown, "importFile"), "threw: import exploded");
  assert.deepEqual(fieldOf(thrown, "canImportAs"), { COMP_CROPPED_LAYERS: "true" });
  const returnedNull = evidenceOf(plan(hostWithImporter("return true;", "return null;").apply, "svg-null"), "SVG_IMPORT_FAILED");
  assert.equal(fieldOf(returnedNull, "importFile"), "returned null");
});

test("an import that returns null with nothing added keeps the plain evidence, and one that added nothing usable removes nothing", () => {
  const loaded = hostWithImporter("return true;", "return null;");
  const before = loaded.projectItems.length;
  const evidence = evidenceOf(plan(loaded.apply, "svg-null-clean"), "SVG_IMPORT_FAILED");
  assert.equal(fieldOf(evidence, "importFile"), "returned null");
  assert.equal(loaded.projectItems.length, before);
});

test("an import that throws after adding an item removes it, so a failed import leaks nothing", () => {
  const loaded = hostWithImporter("return true;", 'globalThis.__leak = app.project.items.addFolder("leaked"); throw new Error("import exploded");');
  const evidence = evidenceOf(plan(loaded.apply, "svg-threw-leak"), "SVG_IMPORT_FAILED");
  assert.equal(fieldOf(evidence, "importFile"), "threw: import exploded; AE added 1 item, removed 1");
  assert.equal(evaluateJson(loaded.context, "__leak.removed"), true);
});

const READ_BUSY_ITEM = `(function () {
  var item = app.project.item(1), id = item.id;
  Object.defineProperty(item, "id", { get: function () { if (globalThis.__armed) throw new Error("busy"); return id; } });
})()`;

test("an item whose id could not be read before the import is never mistaken for one the import added", () => {
  const importFile = 'globalThis.__armed = false; globalThis.__leak = app.project.items.addFolder("added"); return null;';
  const loaded = hostWithImporter("globalThis.__armed = true; return true;", importFile);
  vm.runInContext(READ_BUSY_ITEM, loaded.context);
  const evidence = evidenceOf(plan(loaded.apply, "svg-unreadable"), "SVG_IMPORT_FAILED");
  assert.match(textAt(evidence, "importFile"), /project left as it is/);
  assert.equal(evaluateJson(loaded.context, "app.project.item(1).removed"), false, "the user's own item survives");
  assert.equal(evaluateJson(loaded.context, "__leak.removed"), false, "nothing is removed when what was added cannot be told apart");
});

/**
 * The rocket run's third batch took After Effects down mid-apply and left no
 * trace of which operation it was running. The host now records the plan and
 * operation before each step and removes the record when the apply ends
 * either way, so a record that survives names what AE was doing when it quit.
 */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { loadApplyPlan } from "./host-apply-harness.js";
import { applyPlan, assertApplied } from "./host-plan-io.js";
import { evaluateJson } from "./host-vm-context.js";
import { fieldOf, readJson } from "./json-narrow.js";
import { hostText } from "./host-sources.js";

const BREADCRUMB = "/user-data/extynt/apply-in-flight.json";
const renames = [
  { operation: "set_layer_name", compositionId: "comp-main", layerId: "layer-title", name: "First" },
  { operation: "set_layer_name", compositionId: "comp-main", layerId: "layer-title", name: "Second" },
];

function recordBreadcrumbs(writtenContents: Map<string, string>): string[] {
  const recorded: string[] = [];
  const store = writtenContents.set.bind(writtenContents);
  writtenContents.set = (path, text) => {
    if (path === BREADCRUMB) recorded.push(text);
    return store(path, text);
  };
  return recorded;
}

test("an apply records each operation before running it and leaves nothing behind when it returns", () => {
  const { apply, writtenFiles, writtenContents } = loadApplyPlan();
  const recorded = recordBreadcrumbs(writtenContents);
  const result = applyPlan(apply, "breadcrumb-ok", renames);
  assert.equal(fieldOf(result, "ok"), true);
  const summaries = recorded.map((text) => {
    const record = readJson(text);
    return [fieldOf(record, "planId"), fieldOf(record, "index"), fieldOf(record, "operation"), fieldOf(record, "operationCount")];
  });
  assert.deepEqual(summaries, [["breadcrumb-ok", 0, "set_layer_name", 2], ["breadcrumb-ok", 1, "set_layer_name", 2]]);
  assert.equal(writtenFiles.has(BREADCRUMB), false, "a finished apply removes its record");
});

test("an apply that fails partway also removes its record", () => {
  const { apply, title, writtenFiles, writtenContents } = loadApplyPlan();
  const recorded = recordBreadcrumbs(writtenContents);
  let renamed = 0;
  Object.defineProperty(title, "name", {
    configurable: true,
    get: () => "Title",
    set: () => {
      renamed += 1;
      if (renamed > 1) throw new Error("layer is locked");
    },
  });
  const result = applyPlan(apply, "breadcrumb-failed", renames);
  assert.equal(fieldOf(result, "ok"), false);
  assert.equal(fieldOf(result, "error", "operationIndex"), 1, "the failure is in the apply phase, after the first write");
  assert.equal(recorded.length, 2, "both operations were recorded before they ran");
  assert.equal(writtenFiles.has(BREADCRUMB), false, "a failed apply that returned removes its record");
});

test("a record an apply never removed is read back with its plan and operation", () => {
  const { context, writtenFiles, writtenContents } = loadApplyPlan();
  const surviving = { planId: "plan-mufnx0ev-dt5sg4", index: 16, operationCount: 20, operation: "reorder_layer", layerId: "__new__:layer0", startedAt: "1790262248421" };
  const record = JSON.stringify(surviving);
  writtenContents.set(BREADCRUMB, record);
  writtenFiles.set(BREADCRUMB, record.length);
  assert.deepEqual(evaluateJson(context, "aeReadApplyBreadcrumb()"), surviving);
  assert.equal(writtenFiles.has(BREADCRUMB), true, "reading is read-only; the next apply replaces the record");
});

test("an apply suppresses modal dialogs while it runs and restores them after", () => {
  const { apply, context } = loadApplyPlan();
  const events: string[] = [];
  Object.assign(context, { recordDialogEvent: (event: string) => events.push(event) });
  const hooks = "app.beginSuppressDialogs = function () { recordDialogEvent('suppress'); }; app.endSuppressDialogs = function (alert) { recordDialogEvent('restore:' + alert); };";
  vm.runInContext(hooks, context);
  assertApplied(applyPlan(apply, "dialogs", renames.slice(0, 1)));
  assert.deepEqual(events, ["suppress", "restore:false"]);
  const brokenShape = { operation: "set_shape_path", compositionId: "comp-main", layerId: "layer-shape", groupId: "__new__:missing", path: { vertices: [[0, 0], [1, 1]], closed: false } };
  const failed = applyPlan(apply, "dialogs-failed", [brokenShape]);
  assert.equal(fieldOf(failed, "ok"), false);
  const suppressions = events.filter((event) => event === "suppress").length;
  assert.equal(suppressions, events.filter((event) => event.startsWith("restore")).length, "every suppression is restored, even on failure");
});

test("the probe reports a surviving record without removing it", () => {
  const source = hostText("probe.jsx");
  assert.match(source, /var interruptedApply = typeof aeReadApplyBreadcrumb === "function" \? aeReadApplyBreadcrumb\(\) : null;\s*if \(interruptedApply\) envelope\.result\.interruptedApply = interruptedApply;/);
});

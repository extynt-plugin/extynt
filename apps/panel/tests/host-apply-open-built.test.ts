/** After a plan that built a composition, the host opens it in the viewer, unless it is only a precomp inside another comp. */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { type FakeCompItem, loadApplyPlan } from "./host-apply-harness.js";
import { applyPlan, assertApplied } from "./host-plan-io.js";

function createComp(placeholder: string, name: string) {
  return { operation: "create_composition", newCompositionId: placeholder, name, width: 1920, height: 1080, durationSeconds: 4, frameRate: 30 };
}

function viewerRig(nestedNames: ReadonlyArray<string> = []) {
  const rig = loadApplyPlan();
  const viewer: string[] = [];
  Object.assign(rig.context, {
    announceOpened: (name: string) => viewer.push(name),
    announceCreated: (created: FakeCompItem) => {
      if (nestedNames.includes(created.name)) created.usedIn.push(rig.comp);
    },
  });
  vm.runInContext(
    `(function () {
      var items = app.project.items;
      var addComp = items.addComp;
      items.addComp = function () {
        var created = addComp.apply(items, arguments);
        created.openInViewer = function () { announceOpened(created.name); };
        announceCreated(created);
        return created;
      };
    })()`,
    rig.context,
  );
  return { ...rig, viewer };
}

test("a created top level composition is opened in the viewer after the plan", () => {
  const { apply, viewer } = viewerRig();
  assertApplied(applyPlan(apply, "open-built", [createComp("__new__:a", "Built A"), createComp("__new__:b", "Built B")]));
  assert.deepEqual(viewer, ["Built B"], "the last top level comp wins");
});

test("a created composition used as a precomp in another comp is not opened", () => {
  const { apply, viewer } = viewerRig(["Sub"]);
  assertApplied(applyPlan(apply, "open-sub", [createComp("__new__:main", "Scene"), createComp("__new__:sub", "Sub")]));
  assert.deepEqual(viewer, ["Scene"], "the user stays in their comp, not the subcomp");
  const only = viewerRig(["Only Sub"]);
  applyPlan(only.apply, "open-only-sub", [createComp("__new__:s", "Only Sub")]);
  assert.deepEqual(only.viewer, []);
});

test("a plan that creates no composition leaves the viewer alone", () => {
  const { apply, viewer, comp } = viewerRig();
  Object.assign(comp, { openInViewer: () => viewer.push(comp.name) });
  const rename = { operation: "set_layer_name", compositionId: "comp-main", layerId: "layer-title", name: "Renamed" };
  assertApplied(applyPlan(apply, "no-comp", [rename]));
  assert.deepEqual(viewer, []);
});

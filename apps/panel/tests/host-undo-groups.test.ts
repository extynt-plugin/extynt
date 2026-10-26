/**
 * Apply-plan undo groups: every project write the apply path makes (steps, the frame probe, the selection restore, the viewer
 * moves) lands inside one of the plan's own undo groups, begin and end stay balanced across batches, failures and rollbacks,
 * and the plan reports how many groups hold a step, which is the number of Edit > Undo presses that take it back.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { type JsonObject, type JsonValue } from "@extynt/decode";
import { loadCaptureAdapters } from "./host-apply-harness.js";
import { onLayer, setLayerProperty } from "./host-plan-io.js";
import { fieldOf, readJson, recordOf } from "./json-narrow.js";
import { UndoRig } from "./host-undo-rig.js";

const POSITION = "ADBE Transform Group/ADBE Position";
const GROUP_EDGES = ["begin", "end"];

const RENDER_NOW = onLayer("render_composition", "layer-title", {
  outputPath: "/renders/title.mov",
  destinationPolicy: "explicit-local-path",
  executeAuthorization: "RENDER_NOW",
});

function setPosition(value: JsonValue): JsonObject {
  return setLayerProperty("layer-title", "transform.position", POSITION, value);
}

function assertBalanced(events: readonly string[]): void {
  let open = 0;
  for (const event of events) {
    if (event === "begin") {
      assert.equal(open, 0, `a group opened inside another: ${events.join(" ")}`);
      open += 1;
    }
    if (event === "end") {
      assert.equal(open, 1, `a group closed that was not open: ${events.join(" ")}`);
      open -= 1;
    }
  }
  assert.equal(open, 0, `a group was left open: ${events.join(" ")}`);
}

function groupEdges(rig: UndoRig): string[] {
  return rig.events.filter((event) => GROUP_EDGES.includes(event));
}

function renderRig(failRender = false): UndoRig {
  const rig = new UndoRig();
  const queue = rig.app.project.renderQueue;
  const { items } = queue;
  const add = items.add;
  const render = queue.render;
  const queueInAME = queue.queueInAME;
  items.add = (comp) => {
    rig.events.push(`rq-add@${rig.depth}`);
    rig.app.project.revision += 1;
    const item = add(comp);
    rig.stack.push(() => {
      item.remove();
    });
    return item;
  };
  queue.render = () => {
    rig.events.push(`render@${rig.depth}`);
    if (failRender) throw new Error("disk full");
    render();
    rig.app.project.revision += 1;
  };
  queue.queueInAME = (start) => {
    rig.events.push(`ame@${rig.depth}`);
    return queueInAME(start);
  };
  return rig;
}

function halfResolutionCapture() {
  const adapters = loadCaptureAdapters();
  const writes: string[] = [];
  let factor = [2, 2];
  Object.defineProperty(adapters.comp, "resolutionFactor", {
    configurable: true,
    get: () => factor,
    set: (next: number[]) => {
      writes.push(JSON.stringify(next));
      factor = next;
    },
  });
  const capture = (extra: JsonObject): JsonObject => {
    const request = { operation: "capture_frame", captureId: "thumb-before-plan-1", compositionId: "comp-capture", time: 1, width: 1920, height: 1080, format: "png", ...extra };
    return recordOf(readJson(adapters.capture(JSON.stringify(request))));
  };
  return { capture, writes, get factor() {
    return factor;
  } };
}

test("a successful plan restores the selection inside its undo group, never after it closes", () => {
  const rig = new UndoRig();
  const result = rig.apply("sel-ok", [setPosition([640, 360])]);
  assert.equal(fieldOf(result, "ok"), true, JSON.stringify(fieldOf(result, "error")));
  assert.equal(rig.selected, true, "the user's selection is back");
  assert.ok(rig.events.includes("select:true@1"), `the restore ran inside the group: ${rig.events.join(" ")}`);
  assert.deepEqual(rig.loose, [], "no project write ran outside an undo group");
  assert.equal(rig.events[rig.events.length - 1], "end", "the group closes last");
  assertBalanced(rig.events);
});

test("a built composition is opened in the viewer inside the plan's undo group", () => {
  const rig = new UndoRig();
  const result = rig.apply("built", [{ operation: "create_composition", newCompositionId: "__new__:scene", name: "Scene", width: 1920, height: 1080, durationSeconds: 4, frameRate: 30 }]);
  assert.equal(fieldOf(result, "ok"), true, JSON.stringify(fieldOf(result, "error")));
  assert.ok(rig.events.includes("viewer:Scene@1"), `the built comp opened inside the group: ${rig.events.join(" ")}`);
  assert.deepEqual(rig.loose, []);
  assertBalanced(rig.events);
  assert.equal(fieldOf(result, "changedUndoGroups"), 1);
});

test("undo groups stay balanced across batch boundaries and count only the groups that hold a step", () => {
  const rig = new UndoRig();
  const result = rig.apply("batched", [setPosition([640, 360]), setPosition([640, 360]), setPosition([100, 100])], 1);
  assert.equal(fieldOf(result, "ok"), true, JSON.stringify(fieldOf(result, "error")));
  assert.equal(fieldOf(result, "undoGroups"), 3, "three groups were opened");
  assert.equal(fieldOf(result, "changedUndoGroups"), 2, "two of them hold a step: the last group is counted too");
  assert.equal(fieldOf(result, "receipt", "changedUndoGroups"), 2);
  assert.deepEqual(rig.loose, []);
  assert.equal(rig.maxDepth, 1);
  assertBalanced(rig.events);
  assert.deepEqual(groupEdges(rig), ["begin", "end", "begin", "end", "begin", "end"]);
});

test("a plan whose groups changed nothing reports zero changed groups", () => {
  const rig = new UndoRig();
  rig.position.value = [640, 360];
  const result = rig.apply("same", [setPosition([640, 360])]);
  assert.equal(fieldOf(result, "ok"), true, JSON.stringify(fieldOf(result, "error")));
  assert.equal(fieldOf(result, "undoGroups"), 1);
  assert.equal(fieldOf(result, "changedUndoGroups"), 0, "an Undo press for this plan would take back the step below it");
});

test("a failed batch restores the selection inside its group before the rollback presses Undo once per changed group", () => {
  const rig = new UndoRig();
  const before = JSON.stringify(rig.position.value);
  const result = rig.apply("rolled", [setPosition([640, 360]), setPosition([640, 360]), setPosition([100, 100]), setPosition("not a position")], 1);
  assert.equal(fieldOf(result, "ok"), false);
  assert.equal(fieldOf(result, "rolledBack"), true, JSON.stringify(result).slice(0, 400));
  assert.deepEqual(rig.pressed, [16, 16], "two groups held a step, so Undo was pressed twice");
  assert.equal(JSON.stringify(rig.position.value), before);
  assert.equal(fieldOf(result, "changedUndoGroups"), 2);
  assert.equal(rig.selected, true);
  const restore = rig.events.indexOf("select:true@1");
  const firstUndo = rig.events.indexOf("undo@0");
  assert.ok(restore >= 0 && firstUndo > restore, `the selection was restored inside the last group, before any Undo: ${rig.events.join(" ")}`);
  assert.deepEqual(rig.loose, [], "nothing was written between the plan's groups and the Undo presses, or after them");
  assertBalanced(rig.events);
});

test("a failure that cannot roll back still closes its group with the selection restored inside it", () => {
  const rig = new UndoRig();
  rig.app.executeCommand = () => undefined;
  const result = rig.apply("unclean", [setPosition([640, 360]), setPosition("not a position")]);
  assert.equal(fieldOf(result, "ok"), false);
  assert.equal(fieldOf(result, "mayHaveMutated"), true);
  assert.equal(fieldOf(result, "receipt", "changedUndoGroups"), 1, "the one group holds the first write");
  assert.ok(rig.events.includes("select:true@1"));
  assert.deepEqual(rig.loose, []);
  assertBalanced(rig.events);
});

test("a render runs between the plan's undo groups, never inside one, and the writes around it stay grouped", () => {
  const rig = renderRig();
  const result = rig.apply("render-then-move", [RENDER_NOW, setPosition([100, 100])]);
  assert.equal(fieldOf(result, "ok"), true, JSON.stringify(fieldOf(result, "error")));
  assert.ok(rig.events.includes("rq-add@1"), `the queue item is added inside the plan's group: ${rig.events.join(" ")}`);
  assert.ok(rig.events.includes("render@0"), `the render runs with no group open: ${rig.events.join(" ")}`);
  assert.ok(!rig.events.some((event) => /^render@[1-9]/.test(event)), "no render ran inside a group");
  assert.deepEqual(rig.loose, [], "the position write after the render landed in the reopened group");
  assertBalanced(rig.events);
  assert.deepEqual(rig.events.filter((event) => GROUP_EDGES.includes(event) || event.startsWith("render@")), ["begin", "end", "render@0", "begin", "end"]);
  assert.equal(fieldOf(result, "changedUndoGroups"), 2, "the group before the render and the one after it each hold a step: two Undo presses take the plan back");
  assert.equal(fieldOf(result, "receipt", "changedUndoGroups"), 2);
});

test("what the render itself moves is not counted as a step of the group reopened after it", () => {
  const rig = renderRig();
  const result = rig.apply("render-only", [RENDER_NOW]);
  assert.equal(fieldOf(result, "ok"), true, JSON.stringify(fieldOf(result, "error")));
  assert.ok(rig.events.includes("render@0"), rig.events.join(" "));
  assertBalanced(rig.events);
  assert.equal(fieldOf(result, "changedUndoGroups"), 1, "only the group that added the queue item holds a step; the empty one after the render leaves none");
});

test("a render that throws still leaves the groups balanced and the failure closes the reopened group", () => {
  const rig = renderRig(true);
  const result = rig.apply("render-fails", [RENDER_NOW]);
  assert.equal(fieldOf(result, "ok"), false);
  assert.ok(rig.events.includes("render@0"), rig.events.join(" "));
  assert.equal(rig.depth, 0, "no group is left open");
  assertBalanced(rig.events);
  assert.deepEqual(rig.loose, [], "the queue item cleanup after the failed render ran inside a group");
});

test("a batched plan renders outside its groups and reopens the batch's own group after", () => {
  const rig = renderRig();
  const result = rig.apply("render-batched", [setPosition([640, 360]), RENDER_NOW, setPosition([100, 100])], 2);
  assert.equal(fieldOf(result, "ok"), true, JSON.stringify(fieldOf(result, "error")));
  assertBalanced(rig.events);
  assert.ok(rig.events.includes("render@0"), rig.events.join(" "));
  assert.deepEqual(rig.loose, []);
  assert.equal(rig.events.filter((event) => event === "begin").length, 3, "batch 1 is split around the render, then batch 2 opens its own group");
  assert.equal(fieldOf(result, "changedUndoGroups"), 2, "batch 1 before the render and batch 2 hold a step; batch 1 after the render is empty");
});

test("a Send to Media Encoder handoff also runs between the plan's undo groups", () => {
  const rig = renderRig();
  const handoff = onLayer("render_composition", "layer-title", { outputPath: "/renders/title.mov", destinationPolicy: "explicit-local-path", mediaEncoder: "queue" });
  const result = rig.apply("render-ame", [handoff]);
  assert.equal(fieldOf(result, "ok"), true, JSON.stringify(fieldOf(result, "error")));
  assert.ok(rig.events.includes("ame@0"), `queueInAME ran with no group open: ${rig.events.join(" ")}`);
  assertBalanced(rig.events);
  assert.deepEqual(rig.loose, []);
});

test("a plan refused in preflight opens no group and writes nothing", () => {
  const rig = new UndoRig();
  const missing = { ...setPosition([1, 2]), compositionId: "comp-missing" };
  const result = rig.apply("refused", [missing]);
  assert.equal(fieldOf(result, "ok"), false);
  assert.equal(fieldOf(result, "mayHaveMutated"), false);
  assert.deepEqual(groupEdges(rig), []);
  assert.deepEqual(rig.loose, []);
});

test("a plan thumbnail capture leaves the comp's preview resolution alone: no project write outside an undo group", () => {
  const rig = halfResolutionCapture();
  const result = rig.capture({ keepResolution: true });
  assert.equal(fieldOf(result, "ok"), true, JSON.stringify(result));
  assert.deepEqual(rig.writes, [], "a thumbnail runs between applies and outside every group, so it writes nothing");
  assert.deepEqual(rig.factor, [2, 2]);
});

test("a full-size evidence capture still renders at full resolution and puts the preview setting back", () => {
  const rig = halfResolutionCapture();
  const result = rig.capture({});
  assert.equal(fieldOf(result, "ok"), true, JSON.stringify(result));
  assert.deepEqual(rig.writes, ["[1,1]", "[2,2]"]);
});

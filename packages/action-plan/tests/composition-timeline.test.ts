// Composition-level timeline settings: composition markers, work area, motion blur and the 3D renderer.
import assert from "node:assert/strict";
import test from "node:test";
import { representativeSnapshot, type ProjectSnapshot } from "@extynt/project-graph";
import { type JsonObject, type JsonValue } from "@extynt/decode";
import { fingerprints } from "./fixtures.js";
import { assertOperations, assertSequences, verdict } from "./plan-builders.js";

const compTarget = { compositionId: "comp-main", ...fingerprints } satisfies JsonObject;
const addHit = { type: "add_marker", target: compTarget, time: 2, comment: "Hit" } satisfies JsonObject;
const removeHit = { type: "remove_marker", target: compTarget, time: 2, destructive: true } satisfies JsonObject;
const options = { bounds: { maxOperations: 4 } } satisfies { bounds: JsonObject };

function settingsOp(settings: JsonObject): JsonObject {
  return { type: "set_composition_settings", target: compTarget, settings };
}

function withComposition(patch: Partial<ProjectSnapshot["compositions"][number]>): ProjectSnapshot {
  return { ...representativeSnapshot, compositions: representativeSnapshot.compositions.map((composition) => (composition.id === "comp-main" ? { ...composition, ...patch } : composition)) };
}

test("composition markers add, update and remove through a layerless target", () => {
  assertSequences([
    ["ok", [addHit]],
    ["ok", [addHit, { type: "update_marker", target: compTarget, time: 2, label: 3 }]],
    ["ok", [addHit, removeHit]],
  ], options);
});

test("composition marker writes need a typed field, a confirmation and a known composition", () => {
  assertOperations([
    ["INVALID_OPERATION", { type: "add_marker", target: compTarget, time: 2 }],
    ["DESTRUCTIVE_CONFIRMATION_REQUIRED", { type: "remove_marker", target: compTarget, time: 2 }],
    ["TARGET_NOT_FOUND", { ...addHit, target: { ...compTarget, compositionId: "comp-missing" } }],
  ], options);
});

test("composition marker mutations are checked against the observed marker list", () => {
  const observed = withComposition({ markers: { count: 1, markers: [{ time: 2, comment: "Existing" }] } });
  const codeOf = (operations: readonly JsonValue[]) => verdict(operations, { ...options, snapshot: observed });
  assert.notEqual(codeOf([{ ...addHit, comment: "Again" }]), "ok");
  assert.equal(codeOf([{ type: "update_marker", target: compTarget, time: 2, comment: "Changed" }]), "ok");
  assert.equal(codeOf([removeHit]), "ok");
  assert.notEqual(codeOf([removeHit, removeHit]), "ok");
});

test("set_composition_settings accepts the work area, motion blur and shutter fields", () => {
  const settings = { workAreaStart: 1, workAreaDuration: 4, motionBlur: true, shutterAngle: 180, shutterPhase: -90, motionBlurSamplesPerFrame: 16, motionBlurAdaptiveSampleLimit: 128 };
  assertOperations([["ok", settingsOp(settings)]], options);
});

test("set_composition_settings bounds every timeline field", () => {
  const bad: readonly JsonObject[] = [{ workAreaStart: -1 }, { workAreaDuration: 0 }, { motionBlur: "yes" }, { shutterAngle: 721 }, { shutterPhase: -361 }, { motionBlurSamplesPerFrame: 1 }, { motionBlurSamplesPerFrame: 16.5 }, { motionBlurAdaptiveSampleLimit: 257 }, { unknownSetting: 1 }];
  assertOperations(bad.map((settings) => ["INVALID_VALUE", settingsOp(settings)]), options);
});

test("a work area must end inside the composition, counting a duration change in the same write", () => {
  assertOperations([
    ["ok", settingsOp({ workAreaStart: 10, workAreaDuration: 2 })],
    ["INVALID_VALUE", settingsOp({ workAreaStart: 10, workAreaDuration: 3 })],
    ["INVALID_VALUE", settingsOp({ workAreaDuration: 13 })],
    ["ok", settingsOp({ durationSeconds: 20, workAreaStart: 10, workAreaDuration: 8 })],
    ["INVALID_VALUE", settingsOp({ durationSeconds: 5, workAreaStart: 2, workAreaDuration: 4 })],
  ], options);
});

test("the renderer is checked against the names the composition reports", () => {
  const observed = withComposition({ renderer: "Classic 3D", renderers: ["Classic 3D", "Advanced 3D"] });
  assertOperations([
    ["ok", settingsOp({ renderer: "Advanced 3D" })],
    ["INVALID_VALUE", settingsOp({ renderer: "Cinema 4D" })],
    ["INVALID_VALUE", settingsOp({ renderer: "" })],
  ], { ...options, snapshot: observed });
});

test("a renderer is accepted when the composition reports no list", () => {
  assertOperations([["ok", settingsOp({ renderer: "Whatever Renderer" })]], options);
});

test("set_composition_settings may target a composition this plan creates earlier, and only then", () => {
  const created = { type: "create_composition", newCompositionId: "__new__:comp0", ...fingerprints, name: "Scene", width: 1920, height: 1080, durationSeconds: 6, frameRate: 30 } satisfies JsonObject;
  const settings = { workAreaStart: 1, workAreaDuration: 4, motionBlur: true };
  const planned = { type: "set_composition_settings", target: { ...compTarget, compositionId: "__new__:comp0" }, settings } satisfies JsonObject;
  assertSequences([
    ["ok", [created, planned]],
    ["TARGET_NOT_FOUND", [planned, created]],
    ["TARGET_NOT_FOUND", [created, { ...planned, target: { ...compTarget, compositionId: "__new__:other" } }]],
  ], options);
});

/** Verification of the composition work area, motion blur, renderer and composition markers against a fresh read. */
import assert from "node:assert/strict";
import test from "node:test";
import { objectOf } from "../src/verify/json-fields.js";
import { LAYER, positionLayer, verdict, type Loose } from "./verify-fixtures.js";
import type { VerifiedStep } from "../src/verify/verdicts.js";
import type { Row } from "./native-fixtures.js";

const settingsStep = (settings: Row, comp: Loose = {}): VerifiedStep => verdict({ operations: [{ operation: "set_composition_settings", settings }], hostSteps: [{}], comp });
const states = (step: VerifiedStep): [string | undefined, string | undefined] => [step.verificationState, step.basis];

test("work area reads back within half a frame; the fixture composition runs at 25 fps", () => {
  assert.deepEqual(states(settingsStep({ workAreaStart: 1, workAreaDuration: 4 }, { workAreaStart: 1, workAreaDuration: 4 })), ["exact", "composition-settings"]);
  assert.deepEqual(states(settingsStep({ workAreaStart: 1, workAreaDuration: 4 }, { workAreaStart: 1.01, workAreaDuration: 3.99 })), ["exact", "composition-settings"], "a frame is 0.04 s, so 0.01 s is the same frame");
  assert.deepEqual(states(settingsStep({ workAreaStart: 1 }, { workAreaStart: 1.5 })), ["failed", "composition-settings-mismatch"]);
  assert.deepEqual(states(settingsStep({ workAreaDuration: 4 }, { workAreaDuration: 10 })), ["failed", "composition-settings-mismatch"]);
});

test("layer timing reads back within half a frame of the request, as After Effects snaps it to the frame grid", () => {
  const timingStep = (requested: Row, observed: Row, comp: Row = {}): VerifiedStep => verdict({ operations: [{ operation: "set_layer_timing", ...requested }], layers: [positionLayer([960, 540], { id: LAYER, ...observed })], comp });
  assert.deepEqual(states(timingStep({ outPoint: 12.012012011 }, { outPoint: 12.012012012012 }, { frameRate: 23.976, duration: 12.012012012012 })), ["exact", "layer-timing"], "the end of a 23.976 fps comp");
  assert.deepEqual(states(timingStep({ inPoint: 1, outPoint: 4 }, { inPoint: 1.01, outPoint: 3.99 })), ["exact", "layer-timing"], "0.01 s is the same frame at 25 fps");
  assert.deepEqual(states(timingStep({ outPoint: 12 }, { outPoint: 6 })), ["failed", "layer-timing-mismatch"]);
  assert.deepEqual(states(timingStep({ startTime: 1 }, { startTime: 1.1 })), ["failed", "layer-timing-mismatch"], "0.1 s is more than half a frame at 25 fps");
});

test("motion blur, shutter and renderer are checked when the read carries them", () => {
  const observed = { motionBlur: true, shutterAngle: 180, shutterPhase: -90, motionBlurSamplesPerFrame: 16, motionBlurAdaptiveSampleLimit: 128, renderer: "Advanced 3D" };
  assert.deepEqual(states(settingsStep(observed, observed)), ["exact", "composition-settings"]);
  assert.deepEqual(states(settingsStep({ shutterAngle: 180.3 }, { shutterAngle: 180 })), ["exact", "composition-settings"], "shutter lands within half a degree");
  assert.equal(settingsStep({ shutterAngle: 270 }, { shutterAngle: 180 }).verificationState, "failed");
  assert.equal(settingsStep({ motionBlur: true }, { motionBlur: false }).verificationState, "failed");
  assert.equal(settingsStep({ renderer: "Classic 3D" }, { renderer: "Advanced 3D" }).verificationState, "failed");
  assert.equal(settingsStep({ motionBlurSamplesPerFrame: 32 }, { motionBlurSamplesPerFrame: 16 }).verificationState, "failed");
});

test("a read that does not carry the timeline fields is inconclusive, never a failure", () => {
  const step = settingsStep({ motionBlur: true, renderer: "Advanced 3D" });
  assert.deepEqual(states(step), ["applied_unverified", "composition-timeline-not-in-snapshot"]);
  assert.deepEqual(step.fields, ["motionBlur", "renderer"]);
  const mixed = settingsStep({ workAreaStart: 1, motionBlur: true }, { workAreaStart: 3 });
  assert.equal(mixed.verificationState, "failed", "a field the read does carry is still compared");
});

const marker = (time: number, extra: Row = {}): Row => ({ time, comment: "", duration: 0, label: 0, ...extra });
const markerStep = (operation: Row, markers: Row[] | undefined): VerifiedStep => verdict({ operations: [{ layerId: undefined, ...operation }], hostSteps: [{ layerId: undefined }], comp: markers ? { markers: { count: markers.length, markers } } : {} });

test("composition markers verify add, update and remove from the composition's own marker list", () => {
  assert.deepEqual(states(markerStep({ operation: "add_marker", time: 2, comment: "Hit" }, [marker(2, { comment: "Hit" })])), ["exact", "marker-fields"]);
  assert.deepEqual(states(markerStep({ operation: "add_marker", time: 2, comment: "Hit" }, [marker(2, { comment: "Miss" })])), ["failed", "marker-field-mismatch"]);
  assert.deepEqual(states(markerStep({ operation: "update_marker", time: 2, comment: "Hit" }, [])), ["failed", "marker-missing"]);
  assert.deepEqual(states(markerStep({ operation: "remove_marker", time: 2, destructive: true }, [marker(5)])), ["exact", "marker-absent"]);
  assert.deepEqual(states(markerStep({ operation: "remove_marker", time: 2, destructive: true }, [marker(2)])), ["failed", "marker-still-present"]);
});

test("a read without the composition's marker list leaves composition markers unverified", () => {
  assert.deepEqual(states(markerStep({ operation: "add_marker", time: 2, comment: "Hit" }, undefined)), ["applied_unverified", "composition-markers-not-fully-serialized"]);
});

test("a composition marker verifies from a full read of hundreds of markers", () => {
  const rows = Array.from({ length: 400 }, (_, index) => marker(index * 0.04 + 0.04, { comment: `m${index}` }));
  assert.deepEqual(states(markerStep({ operation: "add_marker", time: 8, comment: "m199" }, rows)), ["exact", "marker-fields"]);
});

test("composition marker time and duration match within half a frame, as After Effects snaps them to the frame grid", () => {
  const add = (time: number, duration: number, observed: Row): [string | undefined, string | undefined] => states(markerStep({ operation: "add_marker", time, duration }, [observed]));
  assert.deepEqual(add(2.013, 0.5, marker(2, { duration: 0.52 })), ["exact", "marker-fields"], "0.013 s and 0.02 s are inside half a 25 fps frame (0.02 s)");
  assert.deepEqual(add(2.013, 0.5, marker(2, { duration: 0.6 })), ["failed", "marker-field-mismatch"], "a duration 0.1 s off is a different duration");
  assert.deepEqual(add(2.05, 0, marker(2)), ["failed", "marker-missing"], "0.05 s is more than half a frame");
  assert.deepEqual(states(markerStep({ operation: "remove_marker", time: 2.01, destructive: true }, [marker(2)])), ["failed", "marker-still-present"]);
});

test("the nearest composition marker within half a frame is the one compared", () => {
  assert.deepEqual(states(markerStep({ operation: "add_marker", time: 2.04, comment: "B" }, [marker(2.02, { comment: "A" }), marker(2.04, { comment: "B" })])), ["exact", "marker-fields"]);
});

test("a genuinely truncated composition marker list stays unverified, however many rows it holds", () => {
  const truncated = verdict({ operations: [{ layerId: undefined, operation: "add_marker", time: 2, comment: "Hit" }], hostSteps: [{ layerId: undefined }], comp: { markers: { count: 1500, truncated: true, markers: [marker(2, { comment: "Hit" })] } } });
  assert.deepEqual(states(truncated), ["applied_unverified", "composition-markers-not-fully-serialized"]);
});

test("removing the last composition marker verifies from an empty list", () => {
  assert.deepEqual(states(markerStep({ operation: "remove_marker", time: 2, destructive: true }, [])), ["exact", "marker-absent"]);
});

test("timeline fields the read does not carry are judged by the host's own read-back right after the write", () => {
  const withHost = (host: Row): VerifiedStep => verdict({ operations: [{ operation: "set_composition_settings", settings: { frameBlending: true, resolutionFactor: [2, 2] } }], hostSteps: [host], comp: {} });
  assert.deepEqual(states(withHost({ verification: "composition-settings-read-back", checkedSettings: 2, differingSettings: [] })), ["exact", "composition-settings-host-read-back"]);
  assert.deepEqual(states(withHost({ verification: "composition-settings-read-back", checkedSettings: 2, differingSettings: ["frameBlending"] })), ["failed", "composition-settings-mismatch"]);
  assert.deepEqual(states(withHost({ verification: "composition-settings-written", checkedSettings: 0, differingSettings: [] })), ["applied_unverified", "composition-timeline-not-in-snapshot"]);
});

test("a failed timing step names only the timing fields the request gave", () => {
  const failed = verdict({ operations: [{ operation: "set_layer_timing", outPoint: 12 }], layers: [positionLayer([960, 540], { id: LAYER, outPoint: 6 })] });
  assert.deepEqual(failed.expected, { outPoint: 12 });
  assert.deepEqual(objectOf(failed.observedTiming)?.outPoint, 6);
});

/** The motion blur, renderer and marker fields a probe carries on a composition reach the snapshot, and only when they are meaningful. */
import assert from "node:assert/strict";
import test from "node:test";
import { decodeOrThrow, jsonObject, type JsonObject } from "@extynt/decode";
import { normalizeProbeSnapshot } from "../src/server-normalize.js";
import { benchProbe } from "./fingerprint-bench-support.js";
import { present } from "./present.js";

const AT = "2026-10-12T12:00:00.000Z";

function firstComposition(extra: JsonObject) {
  const probe = structuredClone(benchProbe("full", 1, 1));
  probe.result.compositions[0] = { ...decodeOrThrow(jsonObject, probe.result.compositions[0]), ...extra };
  return present(normalizeProbeSnapshot(probe, AT).compositions[0]);
}

test("motion blur, shutter, renderer and markers are carried onto the composition snapshot", () => {
  const composition = firstComposition({ motionBlur: true, shutterAngle: 180, shutterPhase: -90, motionBlurSamplesPerFrame: 16, motionBlurAdaptiveSampleLimit: 128, renderer: "Advanced 3D", renderers: ["Classic 3D", "Advanced 3D", 7], markers: { count: 1, markers: [{ time: 2, comment: "Hit" }] } });
  assert.deepEqual([composition.motionBlur, composition.shutterAngle, composition.shutterPhase, composition.motionBlurSamplesPerFrame, composition.motionBlurAdaptiveSampleLimit], [true, 180, -90, 16, 128]);
  assert.equal(composition.renderer, "Advanced 3D");
  assert.deepEqual(composition.renderers, ["Classic 3D", "Advanced 3D"], "a non-string renderer name is dropped");
  assert.equal(composition.markers?.count, 1);
});

test("absent, empty and malformed timeline fields leave the snapshot untouched", () => {
  const plain = firstComposition({});
  assert.equal("motionBlur" in plain, false);
  assert.equal("markers" in plain, false);
  const odd = firstComposition({ motionBlur: "yes", shutterAngle: Number.NaN, renderer: 3, markers: { count: 0, markers: [] } });
  assert.deepEqual(["motionBlur" in odd, "shutterAngle" in odd, "renderer" in odd, "markers" in odd], [false, false, false, false]);
});

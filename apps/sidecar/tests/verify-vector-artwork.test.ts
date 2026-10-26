/** Receipt verdicts for create_vector_artwork: the native importer, and extynt's converter when it refused. */
import type { JsonObject } from "@extynt/decode";
import assert from "node:assert/strict";
import test from "node:test";
import { hostStepOf } from "../src/verify/host-step.js";
import { requestOf } from "../src/verify/plan-request.js";
import type { SnapshotComposition, SnapshotItem } from "../src/verify/snapshot-reply.js";
import { verifyVectorArtworkCreated } from "../src/verify/verify-vector.js";

const hash = "d".repeat(64);
const shapeLayer = { id: "L1", type: "shape", inPoint: 0, outPoint: 6 };
const comp: SnapshotComposition = { id: "C1", width: 64, height: 48, duration: 6, frameRate: 24, layers: [shapeLayer, { ...shapeLayer, id: "L2" }] };
const item: SnapshotItem = { id: "C1", name: "Badge", parentFolderId: "F1" };
const operation = requestOf({ operation: "create_vector_artwork", propertyPath: "", itemId: "", newFolderId: "", newItemId: "__new__:vector", role: "", time: 0, value: 0, fallbackSize: [64, 48] });
const converted: JsonObject = { operation: "create_vector_artwork", name: "Badge", parentFolderId: "F1", sourceHash: hash, svgMetadata: { sourceHash: hash }, nativeShapeLayers: 2, persistsAfterUndo: true, durationSeconds: 6, frameRate: 24, width: 64, height: 48, importer: "converted", importNote: "Imported with extynt's converter (AE's SVG importer refused: SVG_IMPORT_UNSUPPORTED)", converterNotes: { approximated: ["gradient"], skipped: [] } };

function step(extra: JsonObject = {}, omit: ReadonlyArray<string> = []): JsonObject {
  return Object.fromEntries(Object.entries({ ...converted, ...extra }).filter(([key]) => !omit.includes(key)));
}

function verdictFor(row: JsonObject, observed: SnapshotComposition | null = comp, folder: SnapshotItem = item) {
  return verifyVectorArtworkCreated({ request: operation, step: hostStepOf(row), item: folder, comp: observed });
}

test("a converted import verifies when the comp has the requested size, a shape layer, the name and the folder", () => {
  const result = verdictFor(step());
  assert.equal(result.verificationState, "exact");
  assert.equal(result.basis, "managed-svg-hash-converted-shape-layers-and-composition-timing");
  assert.equal(result.importer, "converted");
  assert.match(String(result.importNote), /extynt's converter \(AE's SVG importer refused: SVG_IMPORT_UNSUPPORTED\)/);
});

test("a native import keeps its original basis and says native", () => {
  const result = verdictFor(step({ importer: "native" }, ["width", "height"]), { ...comp, width: 1, height: 1 });
  assert.equal(result.basis, "managed-svg-hash-native-shapes-and-composition-timing");
  assert.equal(result.importer, "native");
  assert.equal(result.importNote, undefined);
  assert.equal(verdictFor(step({}, ["importer"])).importer, "native", "a legacy step with no importer is the native path");
});

test("a converted comp of the wrong size fails, whether the host or the snapshot disagrees", () => {
  assert.equal(verdictFor(step({ width: 32 })).basis, "managed-svg-converted-size-not-requested");
  assert.equal(verdictFor(step(), { ...comp, width: 65 }).basis, "managed-svg-converted-size-mismatch");
  assert.equal(verdictFor(step(), { ...comp, width: 65 }).verificationState, "failed");
});

test("a converted comp without a shape layer fails", () => {
  const result = verdictFor(step(), { ...comp, layers: [{ id: "L1", type: "solid", inPoint: 0, outPoint: 6 }] });
  assert.equal(result.verificationState, "failed");
  assert.equal(result.basis, "managed-svg-converted-no-shape-layers");
});

test("a converted comp the snapshot cannot show is unverified, never exact", () => {
  assert.equal(verdictFor(step(), null).verificationState, "applied_unverified");
  assert.equal(verdictFor(step(), { ...comp, layers: undefined }).basis, "managed-svg-converted-layers-not-in-snapshot");
  assert.equal(verdictFor(step(), { ...comp, width: undefined }).basis, "managed-svg-converted-comp-not-in-snapshot");
});

test("the folder the host reports must be the folder the project shows, for either importer", () => {
  assert.equal(verdictFor(step(), comp, { ...item, parentFolderId: "F2" }).basis, "managed-svg-folder-mismatch");
  assert.equal(verdictFor(step({ importer: "native" }), comp, { ...item, parentFolderId: "F2" }).verificationState, "failed");
});

test("a wrong name or a missing source identity leaves the import unverified", () => {
  assert.equal(verdictFor(step({ name: "Other" })).basis, "managed-svg-import-structural-evidence-incomplete");
  assert.equal(verdictFor(step({ persistsAfterUndo: false })).verificationState, "applied_unverified");
  assert.equal(verdictFor(step({ nativeShapeLayers: 0 })).verificationState, "applied_unverified");
});

test("composition timing is still checked on a converted import", () => {
  const result = verdictFor(step(), { ...comp, layers: [{ ...shapeLayer, outPoint: 1 }] });
  assert.equal(result.verificationState, "failed");
  assert.equal(result.basis, "managed-svg-composition-timing-mismatch");
});

test("a version-routed converted import verifies and carries its plain-words note", () => {
  const result = verdictFor(step({ importNote: "Built with extynt's converter (After Effects 25.6 has no SVG importer)" }));
  assert.equal(result.verificationState, "exact");
  assert.equal(result.importer, "converted");
  assert.equal(result.importNote, "Built with extynt's converter (After Effects 25.6 has no SVG importer)");
  assert.deepEqual(result.converterNotes, { approximated: ["gradient"], skipped: [] });
});

test("a converted import carries the host's native failure (code and evidence), a native one never does", () => {
  const nativeFailure = { code: "SVG_IMPORT_FAILED", evidence: { importFile: "returned null", canImportAs: { COMP_CROPPED_LAYERS: "true", COMP: "false" } } };
  const converted = verdictFor(step({ nativeFailure }));
  assert.equal(converted.verificationState, "exact");
  assert.deepEqual(converted.nativeFailure, nativeFailure);
  assert.equal("nativeFailure" in verdictFor(step()), false, "a version-routed import has no refusal to report");
  assert.equal("nativeFailure" in verdictFor(step({ importer: "native", nativeFailure })), false);
});

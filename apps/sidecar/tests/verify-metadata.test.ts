/** Targeted readback keeps approved identity, exact local controls and unknown coverage. */
import type { JsonObject, JsonValue } from "@extynt/decode";
import assert from "node:assert/strict";
import test from "node:test";
import { listOf, objectOf } from "../src/verify/json-fields.js";
import { boundedCreationEvidence } from "../src/verify/creation-evidence.js";
import { metadataBeforeMatches, metadataReadbackSnapshot } from "../src/verify/metadata-readback.js";

interface Fixture {
  readonly command: JsonObject;
  readonly before: JsonObject;
  readonly readback: JsonObject;
}

interface Parts {
  readonly schema: string;
  readonly target: JsonObject;
  readonly operation: JsonObject;
  readonly coverage: JsonObject;
  readonly readback: JsonObject;
}

const stamp = { epoch: 1, revision: 4 };
const comp = { id: "300", itemIndex: 300, name: "Comp", width: 1920, height: 1080, duration: 10, frameRate: 25 };
const layer = { id: "900", index: 1, name: "Before", locked: false, selected: true, extra: { observed: true } };
const baseTarget = { operationIndex: 0, compositionId: "300", layerId: "900", itemIndex: 300, layerIndex: 1, name: "Before" };
const baseRow = { operationIndex: 0, compositionId: "300", layerId: "900", layerIndex: 1, name: "Before", locked: false, selected: true };
const localEffect = { effectEnabled: true, value: 4, dependencyPolicy: "local-effect-control", inventory: [{ index: 1, matchName: "ADBE Gaussian Blur 2" }] };
const metadata = { composition: comp, layer: { id: "900", index: 1, name: "Before", locked: false, selected: true }, activeCompositionId: "300" };
const initialization = { blurriness: 20, dimensions: 2, repeatEdgePixels: true };
const localCreation = { inventory: [{ index: 1, matchName: "Other" }] };

function row(value: JsonValue | undefined): JsonObject {
  const found = objectOf(value);
  assert.ok(found);
  return found;
}

function list(value: JsonValue | undefined): ReadonlyArray<JsonValue> {
  const found = listOf(value);
  assert.ok(found);
  return found;
}

function assemble(parts: Parts, overrides: { readonly targets?: JsonValue; readonly compositions?: JsonValue } = {}): Fixture {
  const compositions = overrides.compositions ?? [{ ...comp, layers: [layer, { ...layer, id: "901", name: "Unobserved" }] }];
  const readSet = { schemaVersion: parts.schema, digest: "digest", stamp, targets: overrides.targets ?? [{ ...baseTarget, ...parts.target }] };
  return {
    command: { planId: "plan", operations: [parts.operation], readSet },
    before: { ok: true, requestId: "before", result: { hostStamp: stamp, coverage: { kind: "composition-metadata", properties: "unknown", ...parts.coverage }, compositions } },
    readback: { planId: "plan", readSetDigest: "digest", complete: true, stamp: { epoch: 1, revision: 5 }, ...parts.readback },
  };
}

function renameParts(): Parts {
  return {
    schema: "metadata-read-set/1",
    target: { desiredName: "After" },
    operation: { operation: "set_layer_name", compositionId: "300", layerId: "900", name: "After" },
    coverage: {},
    readback: { rows: [{ ...baseRow, name: "After", expectedName: "After" }], compositions: [comp], activeCompositionId: "300" },
  };
}

function renameFixture(): Fixture {
  return assemble(renameParts());
}

function blurFixture(observedValue = 20): Fixture {
  return assemble({
    schema: "blur-control-read-set/1",
    target: { desiredValue: 20, localEffect },
    operation: { operation: "set_effect_control", compositionId: "300", layerId: "900", value: 20 },
    coverage: { localEffect },
    readback: { rows: [{ ...baseRow, value: 20 }], localEffect: { ...localEffect, value: observedValue }, metadata },
  });
}

function control(index: number, value: number, patch: JsonObject): JsonObject {
  return { matchName: `ADBE Gaussian Blur 2-000${index + 1}`, value, keyframeCount: 0, expressionEnabled: false, expression: "", minimum: 0, maximum: 500, ...patch };
}

function creationFixture(firstControl: JsonObject = {}): Fixture {
  const controls = [control(0, 20, firstControl), control(1, 2, {}), control(2, 1, {})];
  const inventory = [...localCreation.inventory, { index: 2, matchName: "ADBE Gaussian Blur 2" }];
  const createdEffect = { effectMatchName: "ADBE Gaussian Blur 2", effectIndex: 2, enabled: true, dependencyPolicy: "local-effect-creation", inventory, controls };
  return assemble({
    schema: "gaussian-create-read-set/1",
    target: { initialization, localCreation, enabled: true },
    operation: { operation: "ensure_effect", compositionId: "300", layerId: "900", initialization, enabled: true },
    coverage: { localCreation },
    readback: { rows: [{ ...baseRow, created: true }], createdEffect, metadata },
  });
}

function reconciled(fixture: Fixture): JsonObject {
  const snapshot = metadataReadbackSnapshot(fixture.command, fixture.readback, fixture.before, "after");
  assert.ok(snapshot);
  return snapshot;
}

function refused(fixture: Fixture): boolean {
  return metadataReadbackSnapshot(fixture.command, fixture.readback, fixture.before, "after") === null;
}

function withReadback(fixture: Fixture, patch: JsonObject): Fixture {
  return { ...fixture, readback: { ...fixture.readback, ...patch } };
}

test("rename retains only approved observations and leaves the before snapshot untouched", () => {
  const fixture = renameFixture();
  const beforeText = JSON.stringify(fixture.before);
  const snapshot = reconciled(fixture);
  const result = row(snapshot.result);
  const layers = list(row(list(result.compositions)[0]).layers);
  assert.equal(snapshot.requestId, "after");
  assert.equal(result.revision, "1:5");
  assert.equal(layers.length, 1);
  assert.equal(row(layers[0]).name, "After");
  assert.deepEqual(result.selectedLayerIds, ["900"]);
  assert.equal(row(result.coverage).otherLayers, "unknown");
  assert.equal(JSON.stringify(fixture.before), beforeText);
});

test("blur and creation serialize exact controls and carry the readback composition metadata", () => {
  for (const fixture of [blurFixture(), creationFixture()]) {
    const result = row(reconciled(fixture).result);
    const composition = row(list(result.compositions)[0]);
    const paths = list(row(list(composition.layers)[0]).propertyPaths);
    assert.equal(row(paths[1]).value, 20);
    assert.equal(composition.name, "Comp");
    assert.equal(row(result.coverage).properties, "unknown");
  }
});

test("readback identity, stamp, row count and scalar types fail closed", () => {
  const rows = renameParts().readback.rows;
  const first = row(list(rows)[0]);
  const faults: ReadonlyArray<JsonObject> = [
    { planId: "other" },
    { readSetDigest: "other" },
    { stamp: { epoch: 2, revision: 5 } },
    { stamp: { epoch: 1, revision: 3 } },
    { stamp: { epoch: 1, revision: "5" } },
    { rows: [] },
    { rows: [{ ...first, selected: "true" }] },
    { compositions: [{ ...comp, width: "1920" }] },
  ];
  for (const fault of faults) assert.equal(refused(withReadback(renameFixture(), fault)), true);
});

test("sparse rows, targets and compositions cannot bypass structural guards", () => {
  assert.equal(refused(withReadback(renameFixture(), { rows: new Array<JsonValue>(1) })), true);
  const targets = assemble(renameParts(), { targets: new Array<JsonValue>(1) });
  assert.equal(metadataBeforeMatches(targets.command, targets.before), false);
  const compositions = assemble(renameParts(), { compositions: new Array<JsonValue>(1) });
  assert.equal(metadataBeforeMatches(compositions.command, compositions.before), false);
});

test("unsupported schema and mismatched before identity refuse", () => {
  const unsupported = assemble({ ...renameParts(), schema: "unsupported" });
  assert.equal(metadataBeforeMatches(unsupported.command, unsupported.before), false);
  const changed = assemble({ ...renameParts(), target: { desiredName: "After", name: "Other" } });
  assert.equal(metadataBeforeMatches(changed.command, changed.before), false);
  assert.equal(metadataBeforeMatches(renameFixture().command, renameFixture().before), true);
});

test("local controls require literal, bounded, unanimated readback", () => {
  const faults: ReadonlyArray<JsonObject> = [{ value: "20" }, { maximum: 19 }, { expressionEnabled: true }, { keyframeCount: 1 }];
  for (const fault of faults) assert.equal(refused(creationFixture(fault)), true);
  assert.equal(refused(blurFixture(21)), true);
});

test("creation evidence preserves bounded progress and rejects injected indices", () => {
  const attempted: JsonObject = { action: "add-effect", state: "attempted" };
  const progress: ReadonlyArray<JsonObject> = [attempted, { action: "add-effect", state: "observed", effectIndex: 2 }];
  assert.deepEqual(boundedCreationEvidence(progress), progress);
  for (const effectIndex of ["2", 0, 17, 1.5]) assert.equal(boundedCreationEvidence([attempted, { action: "add-effect", state: "observed", effectIndex }]), undefined);
});

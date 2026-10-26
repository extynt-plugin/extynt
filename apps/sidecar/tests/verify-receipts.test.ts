/** Receipt verification routing, host evidence and expression motion, verified against adapter envelopes built from the native-spike fixture. */
import type { JsonObject, JsonValue } from "@extynt/decode";
import assert from "node:assert/strict";
import test from "node:test";
import { hostStepOf } from "../src/verify/host-step.js";
import { finalHostKeyCount, finalHostKeyDigest } from "../src/verify/property-keys.js";
import { COMP, LAYER, PROPERTY_PATH, animateEvidence, animateOperation, envelopeOf, expressionEvidence, keyedPosition, positionLayer, runVerify, stepsOf, verdict, verification } from "./verify-fixtures.js";
import { entry, makeLayer, omit, type Row } from "./native-fixtures.js";
import type { VerifiedStep } from "../src/verify/verdicts.js";

const EXPRESSION_KEYED_LAYER = makeLayer(LAYER, 1, { propertyPaths: [keyedPosition({ expressionEnabled: true, expression: "value + [0, -10]" })] });
const MOTION_SOURCE = "value + [0, -10]";
const MOTION_OPERATION: Row = { operation: "set_expression", propertyPath: PROPERTY_PATH, source: MOTION_SOURCE, enabled: true };
const MOTION_LAYER = makeLayer(LAYER, 1, { propertyPaths: [keyedPosition({ expressionEnabled: true, expression: MOTION_SOURCE })] });
const keyedLayer = (extra: Row = {}): Row => makeLayer(LAYER, 1, { propertyPaths: [keyedPosition(extra)] });

interface PropertyCase { operation: Row; step: Row; layer: Row; hostSteps: Row[] }

function propertyVerdict(input: PropertyCase): VerifiedStep {
  const found = input.hostSteps.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(input.step));
  const hostSteps = found < 0 ? [input.step, ...input.hostSteps] : input.hostSteps, index = Math.max(found, 0);
  const operations = hostSteps.map((hostStep, position) => (position === index ? input.operation : { operation: hostStep.operation, propertyPath: hostStep.propertyPath }));
  return verdict({ operations, hostSteps, layers: [input.layer] }, index);
}

test("mask verifier matches numbered mask paths and host values", () => {
  const path = { vertices: [[20, 20], [180, 20], [100, 170]], closed: true };
  const readback = { name: "Lab Mask 2", path: { ...path, vertices: [[20, 20], [180.000015258789, 20], [100, 170.000015258789]], inTangents: [[0, 0], [0, 0], [0, 0]], outTangents: [[0, 0], [0, 0], [0, 0]] }, opacity: 72, feather: [2, 3], expansion: 1 };
  const operation = { operation: "add_mask", name: "Lab Mask 2", values: { path, opacity: 72, feather: [2, 3], expansion: 1 } };
  const layer = makeLayer(LAYER, 1, { propertyPaths: [entry("ADBE Mask Parade/ADBE Mask Atom#2", { displayName: "Lab Mask 2" })] });
  const exact = verdict({ operations: [operation], hostSteps: [{ operation: "add_mask", readback }], layers: [layer] });
  assert.equal(exact.verificationState, "exact", JSON.stringify(exact));
  assert.equal(exact.basis, "mask-host-and-snapshot-readback");
  const moved = { ...readback, path: { ...readback.path, vertices: [[20, 20], [181, 20], [100, 170]] } };
  const mismatch = verdict({ operations: [operation], hostSteps: [{ operation: "add_mask", readback: moved }], layers: [layer] });
  assert.equal(mismatch.verificationState, "failed");
  assert.equal(mismatch.field, "vertices");
});

test("an earlier reorder is unverified, not failed, when a later reorder moves layers again", () => {
  const layers = [makeLayer("B", 1), makeLayer("A", 2), makeLayer("C", 3)];
  const operation = (layerId: string): Row => ({ operation: "reorder_layer", placement: "beginning", layerId });
  const stepA = { operation: "reorder_layer", compositionId: COMP, layerId: "A" }, stepB = { operation: "reorder_layer", compositionId: COMP, layerId: "B" };
  const at = (steps: Row[], index: number) => verdict({ operations: steps.map((step) => operation(String(step.layerId))), hostSteps: steps, layers }, index);
  assert.equal(at([stepA, stepB], 0).verificationState, "applied_unverified");
  assert.equal(at([stepA], 0).verificationState, "failed", "with no later reorder a mismatch is still a failure");
  assert.equal(at([stepA, { ...stepB, compositionId: "c2" }], 0).verificationState, "failed", "a reorder in another composition does not excuse it");
  assert.equal(at([stepA, stepB], 1).verificationState, "exact");
});

const beforeOrder = (ids: string[]) => envelopeOf(ids.map((id, position) => makeLayer(id, position + 1)));

test("a reorder followed by creates is verified against the batch's net order, not the moment of the reorder", () => {
  const pre = ["a", "b", "16", "c"];
  const operations: Row[] = [
    { operation: "reorder_layer", placement: "beginning", layerId: "16" },
    { operation: "create_layer", layerId: "__new__:one" },
    { operation: "create_layer", layerId: "__new__:two" },
  ];
  const hostSteps: Row[] = [{ operation: "reorder_layer", layerId: "16" }, { operation: "create_layer", requestedLayerId: "__new__:one", layerId: "n1" }, { operation: "create_layer", requestedLayerId: "__new__:two", layerId: "n2" }];
  const at = (final: string[]) => verdict({ operations, hostSteps, layers: final.map((id, position) => makeLayer(id, position + 1)), before: beforeOrder(pre) });
  const applied = at(["n2", "n1", "16", "a", "b", "c"]);
  assert.equal(applied.verificationState, "exact", JSON.stringify(applied));
  assert.equal(applied.basis, "layer-order-net-of-batch");
  const ignored = at(["n2", "n1", "a", "b", "16", "c"]);
  assert.equal(ignored.verificationState, "failed", "a reorder the host did not perform still fails");
  assert.equal(ignored.basis, "layer-order-mismatch");
});

test("a Position write that a later set_layer_parent rewrites is judged by the host's read right after the write", () => {
  const operations: Row[] = [{ operation: "set_layer_property", propertyPath: PROPERTY_PATH, value: [160, 90] }, { operation: "set_layer_parent", parentLayerId: "parent-1" }];
  const parentStep: Row = { operation: "set_layer_parent", compositionId: COMP, layerId: LAYER, parentLayerId: "parent-1" };
  const compensated = positionLayer([220, 130, 0], { parentId: "parent-1" });
  const at = (afterValue: JsonValue | undefined) => verdict({ operations, hostSteps: [{ operation: "set_layer_property", propertyPath: PROPERTY_PATH, afterValue }, parentStep], layers: [compensated, makeLayer("parent-1", 2)] });
  const applied = at([160, 90, 0]);
  assert.equal(applied.verificationState, "exact", JSON.stringify(applied));
  assert.equal(applied.basis, "property-value-applied-then-parent-compensated");
  assert.equal(applied.parentOperationIndex, 1);
  assert.equal(at(undefined).verificationState, "applied_unverified", "no host read: confirmed by compensation only, never failed");
  assert.equal(at([10, 10, 0]).verificationState, "failed", "the host's own read disagreeing with the request is still a failure");
  const noParent = verdict({ operations: operations.slice(0, 1), layers: [compensated] });
  assert.equal(noParent.verificationState, "failed", "without a later parent the final value must match");
});

function assertIgnoredExpressionKeys(): void {
  const ignored = propertyVerdict({ operation: animateOperation, step: animateEvidence(), layer: EXPRESSION_KEYED_LAYER, hostSteps: [animateEvidence(), expressionEvidence({ expressionKeysReferenced: "ignored" })] });
  assert.equal(ignored.verificationState, "applied_unverified");
  assert.equal(ignored.basis, "property-keyframes-superseded-by-expression");
  assert.match(String(ignored.reason), /does not read these keyframes/);
  assert.equal(ignored.observedKeys, 2);
}

function assertReferencedExpressionKeys(): void {
  const referenced = propertyVerdict({ operation: animateOperation, step: animateEvidence(), layer: EXPRESSION_KEYED_LAYER, hostSteps: [animateEvidence(), expressionEvidence({ expressionKeysReferenced: "referenced" })] });
  assert.equal(referenced.verificationState, "exact");
  assert.equal(referenced.basis, "property-keyframe-digest");
  assert.equal(referenced.expressionKeysReferenced, "referenced");
  assert.equal(referenced.expressionMotionUnverified, true);
  assert.match(String(referenced.reason), /expression also drives this property/);
  assert.match(String(referenced.reason), /not verified/);
}

function assertUnclassifiedExpressionKeys(): void {
  const unclassified = propertyVerdict({ operation: animateOperation, step: animateEvidence(), layer: EXPRESSION_KEYED_LAYER, hostSteps: [animateEvidence(), expressionEvidence()] });
  assert.equal(unclassified.verificationState, "applied_unverified");
  assert.equal(unclassified.basis, "property-keyframes-expression-keys-unknown");
  assert.doesNotMatch(String(unclassified.reason), /supersed|no longer drive|inert/);
  assert.match(String(unclassified.reason), /could not tell whether it reads these keyframes/);
}

function assertReverseOrderEvidence(): void {
  const layer = makeLayer(LAYER, 1, { propertyPaths: [omit(entry(PROPERTY_PATH, { valueType: "vector", value: [960, 540], keyframeCount: 2, keyDigest: "2:2:beef" }), "expressionEnabled")] });
  const step = animateEvidence({ expressionEnabled: true });
  const reverse = propertyVerdict({ operation: animateOperation, step, layer, hostSteps: [expressionEvidence({ expressionKeysReferenced: "ignored" }), animateEvidence({ expressionEnabled: true })] });
  assert.equal(reverse.basis, "property-keyframes-superseded-by-expression");
}

function assertExpressionClearedLater(): void {
  const step = animateEvidence({ expressionEnabled: true });
  const clearedLater = propertyVerdict({ operation: animateOperation, step, layer: keyedLayer(), hostSteps: [step, expressionEvidence({ verification: "expression-cleared" })] });
  assert.equal(clearedLater.verificationState, "exact");
  assert.equal(clearedLater.basis, "property-keyframe-digest");
}

function assertDigestMismatchStillFails(): void {
  const step = animateEvidence({ afterDigest: "2:2:dead" });
  const mismatch = propertyVerdict({ operation: animateOperation, step, layer: EXPRESSION_KEYED_LAYER, hostSteps: [step, expressionEvidence({ expressionKeysReferenced: "ignored" })] });
  assert.equal(mismatch.verificationState, "failed");
  assert.equal(mismatch.basis, "keyframe-digest-mismatch");
}

test("receipt verification tells an expression that reads the keys from one that ignores them", () => {
  assertIgnoredExpressionKeys();
  assertReferencedExpressionKeys();
  assertUnclassifiedExpressionKeys();
  assertReverseOrderEvidence();
  const plain = propertyVerdict({ operation: animateOperation, step: animateEvidence(), layer: keyedLayer(), hostSteps: [animateEvidence()] });
  assert.equal(plain.verificationState, "exact");
  assert.equal(plain.basis, "property-keyframe-digest");
  assertExpressionClearedLater();
  assertDigestMismatchStillFails();
});

test("the key digest reaches the verifier only through the details call", () => {
  const withDigest = propertyVerdict({ operation: animateOperation, step: animateEvidence(), layer: keyedLayer(), hostSteps: [animateEvidence()] });
  assert.equal(withDigest.basis, "property-keyframe-digest");
  const counted = makeLayer(LAYER, 1, { propertyPaths: [entry(PROPERTY_PATH, { valueType: "vector", value: [960, 540], keyframeCount: 2 })] });
  const countOnly = propertyVerdict({ operation: animateOperation, step: animateEvidence(), layer: counted, hostSteps: [animateEvidence()] });
  assert.equal(countOnly.verificationState, "applied_unverified");
  assert.equal(countOnly.basis, "property-keyframe-count-only");
  const truncated = propertyVerdict({ operation: animateOperation, step: animateEvidence(), layer: keyedLayer({ keyDigestTruncated: true }), hostSteps: [animateEvidence()] });
  assert.equal(truncated.basis, "property-keyframes-truncated");
});

test("a property omitted by the layer property cap is unverified, not a failed write", () => {
  const layer = (truncated: boolean) => makeLayer(LAYER, 1, { propertyPaths: [], propertyPathsTruncated: truncated });
  const capped = propertyVerdict({ operation: animateOperation, step: animateEvidence(), layer: layer(true), hostSteps: [animateEvidence()] });
  assert.equal(capped.verificationState, "applied_unverified");
  assert.equal(capped.basis, "property-path-not-in-truncated-layer-snapshot");
  const complete = propertyVerdict({ operation: animateOperation, step: animateEvidence(), layer: layer(false), hostSteps: [animateEvidence()] });
  assert.equal(complete.verificationState, "failed");
  assert.equal(complete.basis, "property-path-missing");
});

function motionCase(step: Row): PropertyCase {
  return { operation: MOTION_OPERATION, step, layer: MOTION_LAYER, hostSteps: [step, animateEvidence()] };
}

test("receipt verification reports expression motion evidence instead of the stored string alone", () => {
  const sample = (time: number, value: string) => ({ time, value });
  const moving = propertyVerdict(motionCase(expressionEvidence({ expressionSamples: [sample(0, "[960,1400]"), sample(5, "[960,600]"), sample(10, "[960,-200]")], expressionChanges: true, expressionSampleMisses: 0 })));
  assert.deepEqual([moving.verificationState, moving.basis, moving.sampledTimes], ["exact", "property-expression-motion", 3]);
  const frozen = propertyVerdict(motionCase(expressionEvidence({ expressionSamples: [sample(0, "[960,1400]"), sample(5, "[960,1400]")], expressionChanges: false, expressionSampleMisses: 0 })));
  assert.deepEqual([frozen.verificationState, frozen.basis], ["applied_unverified", "expression-value-constant-not-motion"]);
  assert.match(String(frozen.reason), /same value at every sampled time/);
  const unsampled = propertyVerdict(motionCase(expressionEvidence({ expressionSamples: [], expressionChanges: false, expressionSampleMisses: 5 })));
  assert.deepEqual([unsampled.verificationState, unsampled.basis], ["applied_unverified", "expression-motion-not-sampled"]);
  const lateError = propertyVerdict(motionCase(expressionEvidence({ expressionSamples: [sample(0, "[960,540]")], expressionChanges: false, expressionSampledError: "ReferenceError: sourceRectAtTime is undefined" })));
  assert.deepEqual([lateError.verificationState, lateError.basis], ["failed", "expression-evaluation-error"]);
});

test("a cleared or static expression is an exact state, and a changed enabled flag is a failure", () => {
  const clearedStep = { operation: "set_expression", compositionId: COMP, layerId: LAYER, propertyPath: PROPERTY_PATH, verification: "expression-cleared" };
  const cleared = propertyVerdict({ operation: { operation: "set_expression", propertyPath: PROPERTY_PATH, source: "", enabled: false }, step: clearedStep, layer: keyedLayer({ expressionEnabled: false, expression: null }), hostSteps: [] });
  assert.deepEqual([cleared.verificationState, cleared.basis], ["exact", "property-expression-cleared"]);
  const staticProperty = entry(PROPERTY_PATH, { valueType: "vector", value: [960, 540], expressionEnabled: true, expression: "[960, 540]" });
  const staticStep = expressionEvidence({ observedSource: "[960, 540]", expressionSamples: [{ time: 0, value: "[960,540]" }, { time: 5, value: "[960,540]" }], expressionChanges: false });
  const staticState = propertyVerdict({ operation: { operation: "set_expression", propertyPath: PROPERTY_PATH, source: "[960, 540]", enabled: true }, step: staticStep, layer: makeLayer(LAYER, 1, { propertyPaths: [staticProperty] }), hostSteps: [] });
  assert.deepEqual([staticState.verificationState, staticState.basis], ["exact", "property-expression-state"]);
  const wrong = propertyVerdict({ operation: { operation: "set_expression", propertyPath: PROPERTY_PATH, source: "x", enabled: true }, step: staticStep, layer: makeLayer(LAYER, 1, { propertyPaths: [entry(PROPERTY_PATH, { expressionEnabled: false })] }), hostSteps: [] });
  assert.deepEqual([wrong.verificationState, wrong.basis], ["failed", "expression-state-mismatch"]);
});

test("the keyframe helpers read the last matching host step", () => {
  const steps: JsonObject[] = [
    { operation: "animate_property", compositionId: COMP, layerId: LAYER, propertyPath: PROPERTY_PATH, afterKeys: 2, afterDigest: "aa" },
    { operation: "set_layer_property", compositionId: COMP, layerId: LAYER, propertyPath: PROPERTY_PATH, afterKeys: 7, afterDigest: "dd" },
    { operation: "animate_control", compositionId: COMP, layerId: LAYER, propertyPath: PROPERTY_PATH, afterKeys: 5, afterDigest: "bb" },
    { operation: "animate_property", compositionId: COMP, layerId: "layer-2", propertyPath: PROPERTY_PATH, afterKeys: 9, afterDigest: "cc" },
    { operation: "animate_property", compositionId: COMP, layerId: LAYER, propertyPath: PROPERTY_PATH, afterKeys: "5", afterDigest: 5 },
  ];
  const held = steps.map(hostStepOf);
  const step = hostStepOf({ compositionId: COMP, layerId: LAYER, propertyPath: PROPERTY_PATH });
  const elsewhere = (change: JsonObject) => hostStepOf({ compositionId: COMP, layerId: LAYER, propertyPath: PROPERTY_PATH, ...change });
  assert.equal(finalHostKeyCount(held, step), 5, "the last matching animate step with a numeric afterKeys wins");
  assert.equal(finalHostKeyDigest(held, step), "bb", "the last matching animate step with a string afterDigest wins");
  assert.equal(finalHostKeyCount(held, elsewhere({ layerId: "layer-2" })), 9, "a sibling layer keeps its own keyframe count");
  assert.equal(finalHostKeyCount(held, elsewhere({ propertyPath: "ADBE Transform Group/ADBE Scale" })), null, "another property path never matches");
  assert.equal(finalHostKeyDigest(held, elsewhere({ compositionId: "comp-2" })), null, "another composition never matches");
});

test("receipt verification resolves created-layer placeholders to AE-assigned ids", () => {
  const operation = { operation: "create_layer", layerId: "new-layer", layerType: "text", name: "Title" };
  const created = { operation: "create_layer", requestedLayerId: "new-layer", layerId: "layer-9" };
  const layer = makeLayer("layer-9", 1, { name: "Title", type: "text", propertyPaths: [] });
  const found = verdict({ operations: [operation], hostSteps: [created], layers: [layer] });
  assert.deepEqual([found.verificationState, found.basis, found.layerId], ["exact", "layer-exists-name-type", "layer-9"]);
  const missing = verdict({ operations: [operation], hostSteps: [created], layers: [makeLayer("other", 1, { propertyPaths: [] })] });
  assert.deepEqual([missing.verificationState, missing.basis], ["failed", "layer-missing"]);
  const renamed = verdict({ operations: [operation, { operation: "set_layer_name", layerId: "new-layer", name: "Final" }], hostSteps: [created, { operation: "set_layer_name", layerId: "new-layer", afterValue: "Final" }], layers: [{ ...layer, name: "Final" }] });
  assert.equal(renamed.basis, "layer-exists-type-renamed-later");
});

test("receipt verification routes project-item and render operations before layer lookup", () => {
  const folder = verdict({ operations: [{ operation: "create_folder", newFolderId: "f-new" }], hostSteps: [{ operation: "create_folder", requestedFolderId: "f-new", folderId: "6", name: "Folder", parentFolderId: "0" }] });
  assert.deepEqual([folder.verificationState, folder.basis, folder.itemId], ["exact", "project-item-exists-name-parent", "6"]);
  const gone = verdict({ operations: [{ operation: "delete_project_item", itemId: "99" }], hostSteps: [{ operation: "delete_project_item" }] });
  assert.deepEqual([gone.verificationState, gone.basis], ["exact", "project-item-absent"]);
  const stillThere = verdict({ operations: [{ operation: "delete_project_item", itemId: "7" }], hostSteps: [{ operation: "delete_project_item" }] });
  assert.equal(stillThere.basis, "project-item-still-present");
  const render = verdict({ operations: [{ operation: "render_composition" }], hostSteps: [{ operation: "render_composition", verification: "render-submitted" }] });
  assert.deepEqual([render.verificationState, render.basis], ["applied_unverified", "render-submission-host-evidence"]);
  const missingItem = verdict({ operations: [{ operation: "set_item_name", itemId: "98", name: "x" }], hostSteps: [{}] });
  assert.equal(missingItem.basis, "project-item-missing");
});

test("open_composition is judged by the active composition the host observed, never as a missing layer", () => {
  const opened = (extra: Row) => verdict({ operations: [{ operation: "open_composition", compositionId: COMP }], hostSteps: [{ operation: "open_composition", compositionId: COMP, verification: "viewer-opened", ...extra }] });
  const matched = opened({ activeCompositionId: COMP });
  assert.deepEqual([matched.verificationState, matched.basis], ["exact", "viewer-active-composition"]);
  const mismatched = opened({ activeCompositionId: "comp-other" });
  assert.deepEqual([mismatched.verificationState, mismatched.basis, mismatched.activeCompositionId], ["failed", "viewer-active-composition-mismatch", "comp-other"]);
  const older = opened({});
  assert.deepEqual([older.verificationState, older.basis], ["applied_unverified", "viewer-active-composition-not-reported"], "a host that predates the field proves nothing");
});

test("receipt verification does not claim weak host evidence is exact", () => {
  const evidenceOnly = verdict({ operations: [{ operation: "set_time_remap" }], hostSteps: [{ operation: "set_time_remap", verification: "remap-applied" }], layers: [positionLayer([1, 1])] });
  assert.deepEqual([evidenceOnly.verificationState, evidenceOnly.basis], ["applied_unverified", "time-remap-state-not-read"], "a remap step that did not read the layer back proves nothing");
  const unknownKind = verdict({ operations: [{ operation: "no_such_operation" }], hostSteps: [{}] });
  assert.deepEqual([unknownKind.verificationState, unknownKind.basis], ["applied_unverified", "host-layer-evidence-state-not-in-snapshot"]);
  const enabledOnly = verdict({ operations: [{ operation: "ensure_effect", effectPath: PROPERTY_PATH, enabled: false }], hostSteps: [{ operation: "ensure_effect" }] });
  assert.equal(enabledOnly.basis, "effect-enabled-state-not-in-snapshot");
});

test("an effect creation that names its enabled state is verified by the enabled state the readback shows, and never by one it cannot see", () => {
  const operations = [{ operation: "ensure_effect", effectPath: PROPERTY_PATH, enabled: false }];
  const shows = (enabled: boolean) => verdict({ operations, hostSteps: [{ operation: "ensure_effect" }], layers: [makeLayer(LAYER, 1, { propertyPaths: [entry(PROPERTY_PATH, { valueType: "vector", value: [1, 1], keyframeCount: 0, enabled })] })] });
  assert.deepEqual([shows(false).verificationState, shows(false).basis], ["exact", "effect-enabled-state"], "the readback proves the state that was asked for");
  assert.deepEqual([shows(true).verificationState, shows(true).basis], ["failed", "effect-enabled-mismatch"], "a readback that shows the opposite is a mismatch");
  const unseen = verdict({ operations, hostSteps: [{ operation: "ensure_effect" }] });
  assert.deepEqual([unseen.verificationState, unseen.basis], ["applied_unverified", "effect-enabled-state-not-in-snapshot"], "a readback with no enabled state proves nothing about it");
});

test("composition color, created layers and truncated reads are inconclusive, not failed", () => {
  const settings = { operation: "set_composition_settings", settings: { backgroundColor: [0.5, 0.5, 0.5] } };
  assert.equal(verdict({ operations: [settings], hostSteps: [{}] }, 0).verificationState, "failed", "a snapshot background of black is not mid grey");
  const noColor = verdict({ operations: [settings], hostSteps: [{}], comp: { backgroundColor: undefined } });
  assert.equal(noColor.basis, "composition-background-color-not-in-snapshot");
  const removal = { operations: [{ operation: "remove_layer", layerId: "gone" }], hostSteps: [{ layerId: "gone" }] };
  assert.equal(verdict(removal).basis, "layer-absent");
  const capped = verdict({ ...removal, comp: { truncated: true } });
  assert.equal(capped.basis, "composition-layers-truncated");
  const missingComp = { operation: "create_composition", newCompositionId: "nope" };
  assert.equal(verdict({ operations: [missingComp], hostSteps: [{ compositionId: "nope" }] }).basis, "composition-missing");
  const truncated = verdict({ operations: [missingComp], hostSteps: [{ compositionId: "nope" }], warnings: ["composition-count-limit"] });
  assert.deepEqual([truncated.verificationState, truncated.basis], ["applied_unverified", "composition-missing-truncated-snapshot"]);
});

test("the receipt summarises three bands, inconclusive before failed, and carries the repair packet", () => {
  const exactOp = { operation: "set_layer_name", name: "Layer layer-1" }, badOp = { operation: "set_layer_name", name: "Wrong" };
  const passed = verification({ operations: [exactOp], layers: [makeLayer(LAYER, 1, { propertyPaths: [] })] });
  assert.equal(passed.receipt.postcondition, "passed");
  assert.deepEqual([passed.snapshotOk, passed.wholeRead], [true, true]);
  const weak = verification({ operations: [exactOp, { operation: "set_time_remap" }], hostSteps: [{}, {}], layers: [makeLayer(LAYER, 1, { propertyPaths: [] })] });
  assert.equal(weak.receipt.postcondition, "applied_unverified");
  const failed = verification({ operations: [badOp], layers: [makeLayer(LAYER, 1, { propertyPaths: [] })] });
  assert.equal(failed.receipt.postcondition, "failed");
  assert.deepEqual(failed.receipt.repair, { failedCount: 1, operations: [{ index: 0, operation: "set_layer_name", basis: "layer-name-mismatch", compositionId: COMP, layerId: LAYER }] });
  const referenced = verification({ operations: [animateOperation], hostSteps: [animateEvidence(), expressionEvidence({ expressionKeysReferenced: "referenced" })], layers: [EXPRESSION_KEYED_LAYER] });
  assert.equal(stepsOf(referenced)[0]?.verificationState, "exact");
  assert.equal(referenced.receipt.postcondition, "applied_unverified", "an exact step can still leave the plan unverified when an expression drives the property");
});

test("an unreadable verification read is verification_unavailable, and a scoped read is never whole", () => {
  const plan = { operations: [{ operation: "set_layer_name" }], hostSteps: [{}] };
  const failedRead = runVerify(plan, JSON.stringify({ ok: false, requestId: "r", error: { code: "HOST_READ_FAILED" } }));
  assert.equal(failedRead.receipt.postcondition, "verification_unavailable");
  assert.deepEqual([failedRead.snapshotOk, failedRead.wholeRead], [false, false]);
  assert.equal(runVerify(plan, "not json").receipt.postcondition, "verification_unavailable");
  const layers = [makeLayer(LAYER, 1, { propertyPaths: [] })];
  const scoped = runVerify(plan, envelopeOf(layers, {}, { kind: "compositions", ids: [COMP], includeItems: false }));
  assert.deepEqual([scoped.snapshotOk, scoped.wholeRead], [true, false]);
  assert.deepEqual(runVerify(plan, envelopeOf(layers)).wholeRead, true);
});

test("every applied expression is logged and the receipt carries its bounded excerpt", () => {
  const lines: string[] = [];
  const plan = { operations: [{ operation: "set_expression", propertyPath: PROPERTY_PATH, source: "x".repeat(4096), enabled: true }], hostSteps: [expressionEvidence()] };
  const outcome = runVerify(plan, envelopeOf([MOTION_LAYER]), { log: (line) => lines.push(line) });
  assert.equal(lines.length, 1);
  assert.match(lines[0] ?? "", /^Expression on ADBE Transform Group\/ADBE Position: x+…$/);
  const expressions = outcome.receipt.verification?.expressions ?? [];
  assert.equal(expressions.length, 1);
  assert.equal(expressions[0]?.text, "x".repeat(240));
});

test("render settings that After Effects refused fail the step and adjusted ones stay unverified", () => {
  const sent = { operation: "render_composition", status: "sent-to-media-encoder", verification: "render-sent-to-media-encoder" };
  const refused = verdict({ operations: [{ operation: "render_composition" }], hostSteps: [{ ...sent, settings: [{ field: "videoCodec", status: "refused" }, { field: "format", status: "applied" }] }] });
  assert.deepEqual([refused.verificationState, refused.basis, refused.fields], ["failed", "render-settings-refused", ["videoCodec"]]);
  const adjusted = verdict({ operations: [{ operation: "render_composition" }], hostSteps: [{ ...sent, settings: [{ field: "resize.width", status: "adjusted" }] }] });
  assert.deepEqual([adjusted.verificationState, adjusted.basis, adjusted.fields], ["applied_unverified", "render-settings-adjusted", ["resize.width"]]);
  const clean = verdict({ operations: [{ operation: "render_composition" }], hostSteps: [{ ...sent, settings: [{ field: "format", status: "applied" }] }] });
  assert.deepEqual([clean.verificationState, clean.basis], ["applied_unverified", "media-encoder-host-evidence"]);
});

test("cleanup_project checks every removed item is gone from the fresh read", () => {
  const cleanup = { operation: "cleanup_project", mode: "remove_unused_footage", verification: "project-cleanup-diffed", removedCount: 1 };
  const gone = verdict({ operations: [{ operation: "cleanup_project" }], hostSteps: [{ ...cleanup, removed: [{ id: "99", name: "old.mov", type: "Footage" }] }] });
  assert.deepEqual([gone.verificationState, gone.basis], ["applied_unverified", "project-cleanup-host-diff"]);
  const stillThere = verdict({ operations: [{ operation: "cleanup_project" }], hostSteps: [{ ...cleanup, removed: [{ id: "7", name: "kept", type: "Footage" }] }] });
  assert.deepEqual([stillThere.verificationState, stillThere.basis, stillThere.itemIds], ["failed", "cleanup-item-still-present", ["7"]]);
  const truncated = verdict({ operations: [{ operation: "cleanup_project" }], hostSteps: [{ ...cleanup, removed: [], removedTruncated: true }] });
  assert.equal(truncated.basis, "cleanup-list-truncated");
});

test("an effect a later remove_effect of the same plan took off is unverified, not a failed write", () => {
  const effect = "ADBE Effect Parade/ADBE Gaussian Blur 2", control = `${effect}/ADBE Gaussian Blur 2-0001`;
  const ensure = { operation: "ensure_effect", compositionId: COMP, layerId: LAYER, effectPath: effect };
  const remove = { operation: "remove_effect", compositionId: COMP, layerId: LAYER, effectPath: effect };
  const bare = makeLayer(LAYER, 1, { propertyPaths: [], propertyPathsTruncated: false });
  const after = verdict({ operations: [{ operation: "ensure_effect", effectPath: effect }, { operation: "remove_effect", effectPath: effect }], hostSteps: [ensure, remove], layers: [bare] }, 0);
  assert.equal(after.verificationState, "applied_unverified");
  assert.equal(after.basis, "effect-removed-later-in-plan");
  const set = { operation: "set_effect_control", compositionId: COMP, layerId: LAYER, propertyPath: control };
  const control_ = verdict({ operations: [{ operation: "ensure_effect", effectPath: effect }, { operation: "set_effect_control", propertyPath: control, value: 5 }, { operation: "remove_effect", effectPath: effect }], hostSteps: [ensure, set, remove], layers: [bare] }, 1);
  assert.equal(control_.basis, "effect-removed-later-in-plan");
  const kept = verdict({ operations: [{ operation: "ensure_effect", effectPath: effect }], hostSteps: [ensure], layers: [bare] }, 0);
  assert.equal(kept.verificationState, "failed");
  assert.equal(kept.basis, "property-path-missing");
});

test("a failed read-back that a later operation of the same plan explains is unverified, never a failure to record", () => {
  const animate = { operation: "animate_property", compositionId: COMP, layerId: LAYER, propertyPath: PROPERTY_PATH };
  const edit = { operation: "edit_keyframes", compositionId: COMP, layerId: LAYER, propertyPath: PROPERTY_PATH };
  const wrong = animateEvidence({ afterDigest: "2:2:dead" });
  const run = (later: JsonObject) => verdict({ operations: [animate, later], hostSteps: [wrong, { ...later, compositionId: COMP, layerId: LAYER }], layers: [keyedLayer()] }, 0);
  const moved = run(edit);
  assert.equal(moved.verificationState, "applied_unverified");
  assert.equal(moved.basis, "superseded-by-later-operation");
  assert.equal(moved.readBackBasis, "keyframe-digest-mismatch");
  assert.equal(moved.laterOperation, "edit_keyframes");
  assert.equal(run({ operation: "replace_layer_source", compositionId: COMP, layerId: LAYER }).basis, "superseded-by-later-operation");
  assert.equal(run({ operation: "animate_property", compositionId: COMP, layerId: LAYER, propertyPath: "ADBE Transform Group/ADBE Position" }).basis, "superseded-by-later-operation");
  assert.equal(run({ operation: "set_layer_parent", compositionId: COMP, layerId: LAYER }).verificationState, "failed");
  assert.equal(run({ operation: "set_expression", compositionId: COMP, layerId: LAYER, propertyPath: PROPERTY_PATH }).verificationState, "failed");
  assert.equal(run({ operation: "edit_keyframes", compositionId: COMP, layerId: LAYER, propertyPath: "ADBE Transform Group/ADBE Opacity" }).verificationState, "failed");
  assert.equal(run({ operation: "read_keyframes", compositionId: COMP, layerId: LAYER, propertyPath: PROPERTY_PATH }).verificationState, "failed");
  assert.equal(run({ operation: "edit_keyframes", compositionId: COMP, layerId: "another", propertyPath: PROPERTY_PATH }).verificationState, "failed");
  assert.equal(run({ operation: "set_layer_name", compositionId: COMP, layerId: LAYER }).verificationState, "failed");
});

test("a missing effect is explained only by an operation that takes it away or replaces the layer, never by a timing change", () => {
  const effect = "ADBE Effect Parade/ADBE Gaussian Blur 2";
  const ensure = { operation: "ensure_effect", compositionId: COMP, layerId: LAYER, effectPath: effect };
  const bare = makeLayer(LAYER, 1, { propertyPaths: [], propertyPathsTruncated: false });
  const run = (later: JsonObject) => verdict({ operations: [{ operation: "ensure_effect", effectPath: effect }, later], hostSteps: [ensure, { ...later, compositionId: COMP, layerId: LAYER }], layers: [bare] }, 0);
  assert.equal(run({ operation: "set_layer_timing" }).verificationState, "failed");
  assert.equal(run({ operation: "center_anchor" }).verificationState, "failed");
  assert.equal(run({ operation: "replace_layer_source" }).basis, "superseded-by-later-operation");
});

test("layer operations the host reads back itself are judged from the evidence it returned, never left at host-layer-evidence-state-not-in-snapshot", () => {
  const layers = [makeLayer(LAYER, 1)];
  const judge = (operation: Row, hostStep: Row) => verdict({ operations: [operation], hostSteps: [{ operation: operation.operation, compositionId: COMP, layerId: LAYER, ...hostStep }], layers });
  const states = (result: VerifiedStep) => [result.verificationState, result.basis];
  const rect = { left: 0, top: 0, width: 100, height: 50 };
  assert.deepEqual(states(judge({ operation: "center_anchor" }, { anchorAfter: [50, 25], contentRect: rect })), ["exact", "anchor-centred-host-readback"]);
  assert.equal(judge({ operation: "center_anchor" }, { anchorAfter: [10, 25], contentRect: rect }).verificationState, "failed");
  assert.equal(judge({ operation: "center_anchor" }, {}).verificationState, "applied_unverified", "no evidence sent is no claim");
  const stack = { stackBefore: ["Blur", "Tint"], removedName: "Tint" };
  assert.deepEqual(states(judge({ operation: "remove_effect" }, { ...stack, stackAfter: ["Blur"] })), ["exact", "effect-removed-host-readback"]);
  assert.equal(judge({ operation: "remove_effect" }, { ...stack, stackAfter: ["Blur", "Tint"] }).verificationState, "failed");
  assert.deepEqual(states(judge({ operation: "reorder_effect", index: 1 }, { observedIndex: 1, stackBefore: ["a", "b"], stackAfter: ["b", "a"] })), ["exact", "effect-order-host-readback"]);
  assert.equal(judge({ operation: "reorder_effect", index: 1 }, { observedIndex: 2, stackBefore: ["a", "b"], stackAfter: ["b", "a"] }).verificationState, "failed");
  assert.deepEqual(states(judge({ operation: "resize_solid", width: 320, height: 180 }, { after: { width: 320, height: 180, pixelAspect: 1 } })), ["exact", "solid-size-host-readback"]);
  assert.equal(judge({ operation: "resize_solid", width: 320 }, { after: { width: 640, height: 180, pixelAspect: 1 } }).verificationState, "failed");
  assert.deepEqual(states(judge({ operation: "set_text_path", maskIndex: 1, firstMargin: 12 }, { written: { maskIndex: 1, firstMargin: 12 } })), ["exact", "text-path-host-readback"]);
  assert.equal(judge({ operation: "set_text_path", firstMargin: 12 }, { written: { firstMargin: 3 } }).verificationState, "failed");
  assert.deepEqual(states(judge({ operation: "replace_layer_source", sourceItemId: "9" }, { sourceId: "9" })), ["exact", "layer-source-host-readback"]);
  assert.equal(judge({ operation: "replace_layer_source", sourceItemId: "9" }, { sourceId: "4" }).verificationState, "failed");
  const preset = { operation: "save_layer_preset", outputPath: "preset.ffx" };
  assert.deepEqual(states(judge(preset, { file: "preset.ffx", bytes: 2048, effects: 2 })), ["exact", "preset-file-written"]);
  assert.equal(judge(preset, { file: "preset.ffx", bytes: 0 }).verificationState, "failed");
  assert.deepEqual(states(judge({ operation: "copy_effects" }, { copiedEffects: ["ADBE Tint"], failedEffects: [] })), ["exact", "effects-copied-host-report"]);
  assert.equal(judge({ operation: "copy_effects" }, { copiedEffects: ["ADBE Tint"], failedEffects: ["ADBE Glo2"] }).verificationState, "applied_unverified", "an effect that could not be added is reported, never claimed exact");
  const del = { operation: "edit_keyframes", action: "delete", propertyPath: PROPERTY_PATH }, move = { ...del, action: "move" };
  assert.deepEqual(states(judge(del, { selectedKeys: 1, beforeTimes: [0, 1], afterTimes: [0] })), ["exact", "keys-deleted-host-readback"]);
  assert.equal(judge(del, { selectedKeys: 1, beforeTimes: [0, 1], afterTimes: [0, 1] }).verificationState, "failed");
  assert.deepEqual(states(judge(move, { selectedKeys: 1, beforeTimes: [0, 1], afterTimes: [0, 2], movedTo: [2] })), ["exact", "keys-moved-host-readback"]);
  assert.equal(judge(move, { selectedKeys: 1, beforeTimes: [0, 1], afterTimes: [0, 1], movedTo: [2] }).verificationState, "failed");
});

test("a layer created and pinned in one plan is verified on the Puppet carrier that replaced it", () => {
  const pins = [{ x: 100, y: 100 }];
  const operations = [{ operation: "create_layer", layerId: "__new__:solid", layerType: "solid", name: "Solid" }, { operation: "set_puppet_pins", layerId: "__new__:solid", pins }];
  const hostSteps = [{ operation: "create_layer", requestedLayerId: "__new__:solid", layerId: "58" }, { operation: "set_puppet_pins", requestedLayerId: "58", layerId: "86", carrierLayerId: "86", created: true, pinReadback: { effectPresent: true, carrierLayerId: "86", pins } }];
  const outcome = verification({ operations, hostSteps, layers: [makeLayer("86", 1, { name: "Solid puppet", type: "av", propertyPaths: [] })] });
  const [created, pinned] = stepsOf(outcome);
  assert.deepEqual([created?.verificationState, created?.basis, created?.carrierLayerId], ["exact", "layer-wrapped-in-puppet-carrier", "86"]);
  assert.deepEqual([pinned?.verificationState, pinned?.basis, pinned?.layerId], ["exact", "puppet-pins-read-back", "86"]);
  const unpinned = verification({ operations: operations.slice(0, 1), hostSteps: hostSteps.slice(0, 1), layers: [makeLayer("86", 1, { propertyPaths: [] })] });
  assert.equal(stepsOf(unpinned)[0]?.basis, "layer-missing");
});

test("a Puppet carrier is found in a composition the same plan created, through its alias", () => {
  const pins = [{ x: 100, y: 100 }];
  const operations = [{ operation: "create_layer", layerId: "__new__:solid", layerType: "solid", name: "Solid" }, { operation: "set_puppet_pins", layerId: "__new__:solid", pins }];
  const hostSteps = [{ operation: "create_layer", requestedLayerId: "__new__:solid", layerId: "58" }, { operation: "set_puppet_pins", requestedLayerId: "58", layerId: "86", carrierLayerId: "86", created: true, pinReadback: { effectPresent: true, carrierLayerId: "86", pins } }];
  const makeComp = { operation: "create_composition", compositionId: "__new__:comp0", name: "Comp" };
  const aliased = [{ operation: "create_composition", requestedCompositionId: "__new__:comp0", compositionId: COMP }, ...hostSteps.map((step) => ({ ...step, compositionId: "__new__:comp0" }))];
  const inNewComp = operations.map((operation) => ({ ...operation, compositionId: "__new__:comp0" }));
  const [, createdInNewComp] = stepsOf(verification({ operations: [makeComp, ...inNewComp], hostSteps: aliased, layers: [makeLayer("86", 1, { name: "Solid puppet", type: "av", propertyPaths: [] })] }));
  assert.deepEqual([createdInNewComp?.verificationState, createdInNewComp?.basis], ["exact", "layer-wrapped-in-puppet-carrier"]);
});

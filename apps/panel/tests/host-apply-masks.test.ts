/**
 * Apply-plan host contract: masks, their placeholder ids, snapshot ordinals and shape conversion.
 * The fake host and payload builders live in host-apply-harness.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { type FakeMaskParade, FakeProperty, FakeShape, loadApplyPlan, maskNames, maskOpacity, namedMaskParade, withFreshTextDocuments } from "./host-apply-harness.js";
import { childAt, layerProperty, sourceTextOf } from "./host-fake-lookup.js";
import { applyPlan, assertApplied, assertRefused, stepField } from "./host-plan-io.js";
import { fieldOf, plain } from "./json-narrow.js";
import { type JsonObject, type JsonValue } from "@extynt/decode";

const SQUARE: JsonObject = { vertices: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true };

const SHAPE_TARGET = { compositionId: "comp-main", layerId: "layer-shape" } as const;

function maskOperation(operation: string, fields: JsonObject): JsonObject {
  return { operation, ...SHAPE_TARGET, ...fields };
}

function removeMask(maskId: string): JsonObject {
  return maskOperation("remove_mask", { maskId, destructive: true });
}

function updateMaskOpacity(maskId: string, opacity: number): JsonObject {
  return maskOperation("update_mask", { maskId, values: { opacity } });
}

interface KeyedPathCase {
  readonly layerId: string;
  readonly propertyPath: string;
  readonly role: string;
  readonly keyValues: readonly [JsonValue, JsonValue];
}

const KEYED_PATH_CASES: ReadonlyArray<KeyedPathCase> = [
  { layerId: "layer-title", propertyPath: "ADBE Text Properties/ADBE Text Document", role: "text", keyValues: ["text", "text-after"] },
  { layerId: "layer-title", propertyPath: "ADBE Transform Group/ADBE Position", role: "transform", keyValues: ["transform", "transform-after"] },
  { layerId: "layer-shape", propertyPath: "ADBE Mask Parade/ADBE Mask Atom/ADBE Mask Shape", role: "mask", keyValues: [SQUARE, SQUARE] },
];

test("apply_plan supports text, transform, and mask paths without display-name fallback", () => {
  const { apply, calls, title } = loadApplyPlan();
  withFreshTextDocuments(sourceTextOf(title));
  for (const { layerId, propertyPath, role, keyValues } of KEYED_PATH_CASES) {
    const keyframes = [{ time: 0, value: keyValues[0] }, { time: 1, value: keyValues[1] }];
    const reply = applyPlan(apply, `p-${role}`, [{ operation: "animate_property", compositionId: "comp-main", layerId, propertyPath, role, keyframes }]);
    assert.equal(fieldOf(reply, "ok"), true, role);
  }
  const rejected = applyPlan(apply, "bad", [{
    operation: "animate_property",
    compositionId: "comp-main",
    layerId: "layer-title",
    propertyPath: "ADBE Transform Group/Transform/Position",
    role: "transform.position",
    keyframes: [{ time: 0, value: [0, 0] }, { time: 1, value: [1, 1] }],
  }]);
  assertRefused(rejected, "PROPERTY_NOT_FOUND");
  assert.equal(calls.begin.length, 3);
});

test("apply_plan adds, updates, and removes a mask by an earlier typed placeholder", () => {
  const { apply, shapeLayer } = loadApplyPlan();
  const reply = applyPlan(apply, "mask-lifecycle", [
    maskOperation("add_mask", { newMaskId: "__new__:mask0", name: "Reveal", values: { opacity: 75, feather: [4, 8], expansion: 2 } }),
    maskOperation("update_mask", { maskId: "__new__:mask0", values: { opacity: 20 } }),
    maskOperation("remove_mask", { maskId: "__new__:mask0", destructive: true }),
  ]);
  assert.equal(fieldOf(reply, "ok"), true);
  assert.deepEqual(stepField(reply, "operation"), ["add_mask", "update_mask", "remove_mask"]);
  assert.equal(layerProperty(shapeLayer, "ADBE Mask Parade").children.length, 1);
});

test("apply_plan keeps two removes in one plan on the masks the snapshot named", () => {
  const { apply, shapeLayer } = loadApplyPlan();
  const parade = namedMaskParade(shapeLayer, ["One", "Two", "Three"]);
  const reply = applyPlan(apply, "mask-two-removes", [removeMask("mask:1"), removeMask("mask:2")]);
  assertApplied(reply);
  assert.deepEqual(maskNames(parade), ["Three"]);
  assert.deepEqual(stepField(reply, "name"), ["One", "Two"]);
});

test("apply_plan writes an update that follows a removal in the same plan to the snapshot's mask", () => {
  const { apply, shapeLayer } = loadApplyPlan();
  const parade = namedMaskParade(shapeLayer, ["One", "Two", "Three"]);
  const reply = applyPlan(apply, "mask-remove-then-update", [removeMask("mask:1"), updateMaskOpacity("mask:2", 20)]);
  assertApplied(reply);
  assert.deepEqual(maskNames(parade), ["Two", "Three"]);
  assert.equal(maskOpacity(parade, "Two"), 20);
  assert.equal(maskOpacity(parade, "Three"), 100);
  assert.equal(fieldOf(reply, "steps", 1, "name"), "Two");
});

function replaceWithFreshCopy(stale: FakeProperty): FakeProperty {
  const fresh = Object.assign(new FakeProperty(stale.matchName, stale.name), stale);
  for (const key of Object.keys(stale)) {
    Object.defineProperty(stale, key, {
      get: () => {
        throw new Error("stale Mask reference");
      },
    });
  }
  return fresh;
}

function invalidateMaskReferencesOnInsert(parade: FakeMaskParade): void {
  const addProperty = parade.addProperty.bind(parade);
  parade.addProperty = (matchName) => {
    const before = parade.children.slice();
    const added = addProperty(matchName);
    before.forEach((stale, index) => {
      parade.children[index] = replaceWithFreshCopy(stale);
    });
    return added;
  };
}

test("apply_plan updates an existing mask after add_mask when the host invalidates Mask references on insert", () => {
  const { apply, shapeLayer } = loadApplyPlan();
  const parade = namedMaskParade(shapeLayer, ["One", "Two"]);
  invalidateMaskReferencesOnInsert(parade);
  const reply = applyPlan(apply, "mask-add-then-update", [
    maskOperation("add_mask", { newMaskId: "__new__:fresh", name: "Fresh", values: { opacity: 75 } }),
    updateMaskOpacity("mask:1", 20),
  ]);
  assertApplied(reply);
  assert.deepEqual(maskNames(parade), ["One", "Two", "Fresh"]);
  assert.equal(maskOpacity(parade, "One"), 20);
  assert.equal(maskOpacity(parade, "Two"), 100);
  assert.equal(maskOpacity(parade, "Fresh"), 75);
});

test("apply_plan updates the snapshot's ordinal when no earlier operation removed a mask", () => {
  const { apply, shapeLayer } = loadApplyPlan();
  const parade = namedMaskParade(shapeLayer, ["One", "Two", "Three"]);
  const reply = applyPlan(apply, "mask-control", [updateMaskOpacity("mask:2", 33)]);
  assertApplied(reply);
  assert.deepEqual(maskNames(parade), ["One", "Two", "Three"]);
  assert.equal(maskOpacity(parade, "Two"), 33);
  assert.equal(maskOpacity(parade, "One"), 100);
  assert.equal(maskOpacity(parade, "Three"), 100);
});

test("apply_plan rejects an operation on a mask an earlier operation in the same plan removed", () => {
  const { apply, shapeLayer } = loadApplyPlan();
  const parade = namedMaskParade(shapeLayer, ["One", "Two", "Three"]);
  const reply = applyPlan(apply, "mask-remove-then-edit", [removeMask("mask:1"), updateMaskOpacity("mask:1", 20)]);
  assertRefused(reply, "MASK_REMOVED_EARLIER");
  assert.equal(fieldOf(reply, "phase"), "preflight");
  assert.equal(fieldOf(reply, "mutationState"), "not-applied");
  assert.deepEqual(maskNames(parade), ["One", "Two", "Three"]);
  assert.equal(maskOpacity(parade, "One"), 100);
});

test("apply_plan converts a mask Shape DTO to a native Shape before writing", () => {
  const { apply, shapeLayer } = loadApplyPlan();
  const path = { vertices: [[0, 0], [20, 0], [20, 20]], closed: true };
  const reply = applyPlan(apply, "mask-shape", [maskOperation("add_mask", { newMaskId: "__new__:mask0", name: "Native mask", values: { path } })]);
  assert.equal(fieldOf(reply, "ok"), true);
  const writtenPath = childAt(childAt(layerProperty(shapeLayer, "ADBE Mask Parade"), 1), 0).value;
  assert.ok(writtenPath instanceof FakeShape);
  assert.deepEqual(plain(writtenPath.outTangents), [[0, 0], [0, 0], [0, 0]]);
});

test("apply_plan rejects a forward mask placeholder and a non-destructive remove", () => {
  const { apply } = loadApplyPlan();
  const forward = applyPlan(apply, "mask-forward", [updateMaskOpacity("__new__:later", 20)]);
  assertRefused(forward, "TARGET_NOT_FOUND");
  const remove = applyPlan(apply, "mask-remove", [maskOperation("remove_mask", { maskId: "mask:1" })]);
  assertRefused(remove, "DESTRUCTIVE_CONFIRMATION_REQUIRED");
});

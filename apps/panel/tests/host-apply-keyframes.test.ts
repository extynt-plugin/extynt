/**
 * Apply-plan host contract: keyframe writes on transform properties, merge and replace modes, and rollback of partial key writes.
 * The fake host and payload builders live in host-apply-harness.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { animatePosition, loadApplyPlan } from "./host-apply-harness.js";
import { positionOf } from "./host-fake-lookup.js";
import { TITLE_TARGET, applyPlan, assertApplied, assertRefused, stepField } from "./host-plan-io.js";
import { fieldOf, plain, textAt } from "./json-narrow.js";

const MOVE_KEYS = [{ time: 0, value: [0, 0] }, { time: 1, value: [10, 20] }];

test("apply_plan writes an exact resolved leaf when AE reports canSetValue false and numProperties is unavailable", () => {
  const { apply, title } = loadApplyPlan();
  const position = positionOf(title);
  position.canSetValue = false;
  position.leafNumPropertiesThrows = true;
  const reply = applyPlan(apply, "can-set-value-false", [animatePosition(MOVE_KEYS)]);
  assert.equal(fieldOf(reply, "ok"), true);
  assert.equal(position.numKeys, 2);
});

test("apply_plan reports an explicit non-animatable AE property before writing keys", () => {
  const { apply, title } = loadApplyPlan();
  const position = positionOf(title);
  position.canVaryOverTime = false;
  const reply = applyPlan(apply, "not-animatable", [animatePosition(MOVE_KEYS)]);
  assertRefused(reply, "PROPERTY_NOT_ANIMATABLE");
  assert.equal(position.numKeys, 0);
});

test("apply_plan merges several operations keying one property instead of failing with CONFLICTING_KEYS", () => {
  const { apply, title } = loadApplyPlan();
  const position = positionOf(title);
  const reply = applyPlan(apply, "batch-keys", [
    animatePosition([{ time: 0, value: [0, 0] }, { time: 1, value: [10, 0] }]),
    animatePosition([{ time: 2, value: [20, 0] }, { time: 3, value: [30, 0] }]),
    animatePosition([{ time: 0.5, value: [5, 5] }]),
  ]);
  assertApplied(reply);
  assert.deepEqual(position.keyframes.map((key) => key.time), [0, 0.5, 1, 2, 3]);
  assert.deepEqual(stepField(reply, "keyframeMode"), ["reject", "merge", "merge"]);
});

test("apply_plan rejects pre-existing keys before opening an undo group and honours merge/replace", () => {
  const { apply, calls, title } = loadApplyPlan();
  const position = positionOf(title);
  position.setValueAtTime(5, [1, 1]);
  position.setValueAtTime(6, [2, 2]);
  const beginBefore = calls.begin.length;
  const rejected = applyPlan(apply, "existing", [
    { operation: "set_text_document", ...TITLE_TARGET, text: "must not be written" },
    animatePosition([{ time: 0, value: [0, 0] }]),
  ]);
  assertRefused(rejected, "CONFLICTING_KEYS");
  assert.match(textAt(rejected, "error", "message"), /ADBE Position.*keyframeMode/);
  assert.equal(fieldOf(rejected, "mayHaveMutated"), false);
  assert.equal(calls.begin.length, beginBefore);
  const merged = applyPlan(apply, "merge", [animatePosition([{ time: 0, value: [0, 0] }, { time: 6, value: [9, 9] }], { keyframeMode: "merge" })]);
  assert.equal(fieldOf(merged, "ok"), true);
  assert.deepEqual(plain(position.keyframes), [{ time: 0, value: [0, 0] }, { time: 5, value: [1, 1] }, { time: 6, value: [9, 9] }]);
  const replaced = applyPlan(apply, "replace", [animatePosition([{ time: 1, value: [3, 3] }], { keyframeMode: "replace" })]);
  assert.equal(fieldOf(replaced, "ok"), true);
  assert.deepEqual(plain(position.keyframes), [{ time: 1, value: [3, 3] }]);
  assert.equal(fieldOf(replaced, "steps", 0, "removedKeys"), 3);
  const invalidMode = applyPlan(apply, "bad-mode", [animatePosition([{ time: 2, value: [3, 3] }], { keyframeMode: "overwrite" })]);
  assert.equal(fieldOf(invalidMode, "ok"), false);
});

test("apply_plan rolls back newly written keys when shaping fails after Pass 1 has already written values", () => {
  const { apply, title } = loadApplyPlan();
  const position = positionOf(title);
  position.isSpatial = true;
  const reply = applyPlan(apply, "roving-rollback", [animatePosition([{ time: 1, value: [10, 10] }, { time: 2, value: [20, 20], roving: true }], { keyframeMode: "merge" })]);
  assertRefused(reply, "SPATIAL_UNSUPPORTED");
  assert.equal(position.numKeys, 0);
});

test("apply_plan rolls back a key AE already wrote before Pass 1 itself throws on a later frame", () => {
  const { apply, title } = loadApplyPlan();
  const position = positionOf(title);
  const original = position.setValueAtTime.bind(position);
  let writes = 0;
  position.setValueAtTime = (time, written) => {
    writes += 1;
    if (writes === 2) throw new Error("Value 99 out of range 1 to 3");
    return original(time, written);
  };
  const reply = applyPlan(apply, "pass1-rollback", [animatePosition([{ time: 0, value: [2, 2] }, { time: 1, value: [99, 99] }])]);
  assertRefused(reply, "KEYFRAME_WRITE_FAILED");
  assert.equal(position.numKeys, 0, "the key AE wrote at t=0 before throwing on t=1 must be rolled back");
});

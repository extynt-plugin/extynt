/** apply_plan host contract for Position and Anchor Point writes: separated dimensions go through the visible followers, and the static-write allowlist pairs each role with its path. */

import assert from "node:assert/strict";
import test from "node:test";
import { type FakeLayer, FakeProperty, loadApplyPlan } from "./host-apply-harness.js";
import { childNamed, layerProperty } from "./host-fake-lookup.js";
import { applyPlan, setLayerProperty } from "./host-plan-io.js";
import { fieldOf, plain } from "./json-narrow.js";

const POSITION = "ADBE Transform Group/ADBE Position";
const ANCHOR = "ADBE Transform Group/ADBE Anchor Point";

function separatedTransform(title: FakeLayer): { leader: FakeProperty; x: FakeProperty; y: FakeProperty } {
  const transform = layerProperty(title, "ADBE Transform Group");
  const leader = childNamed(transform, "ADBE Position");
  leader.dimensionsSeparated = true;
  const x = new FakeProperty("ADBE Position_0", "X Position", [], 0, true);
  const y = new FakeProperty("ADBE Position_1", "Y Position", [], 0, true);
  transform.children.push(x, y);
  return { leader, x, y };
}

test("apply_plan writes separated Position through exact visible followers, never its hidden leader", () => {
  const { apply, title, calls } = loadApplyPlan();
  const { leader, x, y } = separatedTransform(title);
  leader.isHidden = true;
  let leaderWrites = 0;
  leader.setValue = () => {
    leaderWrites += 1;
  };
  const result = applyPlan(apply, "separated-position", [setLayerProperty("layer-title", "transform.position", POSITION, [640, 360])]);
  assert.equal(fieldOf(result, "ok"), true, JSON.stringify(result));
  assert.equal(leaderWrites, 0);
  assert.equal(fieldOf(result, "steps", 0, "separatedDimensions"), true);
  assert.equal(x.value, 640);
  assert.equal(y.value, 360);
  assert.equal(calls.begin.length, 1);
});

test("apply_plan rejects incompatible separated Position tuples before opening an undo group", () => {
  const { apply, title, calls } = loadApplyPlan();
  separatedTransform(title);
  const result = applyPlan(apply, "bad-separated-position", [setLayerProperty("layer-title", "transform.position", POSITION, [640, 360, 0])]);
  assert.equal(fieldOf(result, "ok"), false);
  assert.equal(fieldOf(result, "error", "code"), "SEPARATED_POSITION_VALUE_INVALID");
  assert.equal(calls.begin.length, 0);
});

test("a static write to the anchor point is accepted, as the animated one always was", () => {
  const { apply, title, calls } = loadApplyPlan();
  const anchor = new FakeProperty("ADBE Anchor Point", "Anchor Point", [], 0, true);
  layerProperty(title, "ADBE Transform Group").children.push(anchor);
  const written = applyPlan(apply, "anchor-write", [setLayerProperty("layer-title", "transform.anchor", ANCHOR, [0, 0])]);
  assert.equal(fieldOf(written, "ok"), true, JSON.stringify(written));
  assert.deepEqual(plain(anchor.value), [0, 0]);
  assert.equal(calls.begin.length, 1);
  const mismatched = applyPlan(apply, "anchor-mismatch", [setLayerProperty("layer-title", "transform.anchor", POSITION, [0, 0])]);
  assert.equal(fieldOf(mismatched, "ok"), false);
  assert.equal(fieldOf(mismatched, "error", "code"), "INVALID_TARGET");
  assert.equal(calls.begin.length, 1, "the mismatched write must be refused before an undo group is opened");
});

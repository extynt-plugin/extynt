/**
 * Apply-plan host contract: text animators, their range selectors and animator-property leaves.
 * The fake host and payload builders live in host-apply-harness.ts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { type FakeLayer, FakeProperty, leaf, loadApplyPlan, loadExtended } from "./host-apply-harness.js";
import { childAt, childNamed, childrenNamed, lastChildNamed, layerProperty } from "./host-fake-lookup.js";
import { type PlanApply, TITLE_TARGET, applyPlan, assertApplied, assertRefused } from "./host-plan-io.js";
import { fieldOf, plain, textAt } from "./json-narrow.js";
import { type JsonObject, type JsonValue } from "@extynt/decode";

interface AnimatorParts {
  readonly animators: FakeProperty;
  readonly selectors: FakeProperty;
  readonly properties: FakeProperty;
  readonly opacity: FakeProperty;
}

function animatorParts(title: FakeLayer): AnimatorParts {
  const animators = childNamed(layerProperty(title, "ADBE Text Properties"), "ADBE Text Animators");
  const animator = childAt(animators, 0);
  const properties = childNamed(animator, "ADBE Text Animator Properties");
  return { animators, selectors: childNamed(animator, "ADBE Text Selectors"), properties, opacity: childNamed(properties, "ADBE Text Opacity") };
}

function ensureOpacityAnimator(apply: PlanApply, planId: string, opacity: number): JsonObject {
  return applyPlan(apply, planId, [{ operation: "ensure_text_animator", ...TITLE_TARGET, role: "text.opacity", value: opacity }]);
}

function textAnimatorsGroup(title: FakeLayer): FakeProperty {
  return childNamed(layerProperty(title, "ADBE Text Properties"), "ADBE Text Animators");
}

test("apply_plan creates one text animator with a range selector and sets its opacity property; a second call reuses it instead of duplicating", () => {
  const { apply, title } = loadApplyPlan();
  const first = ensureOpacityAnimator(apply, "animator-1", 0);
  assert.equal(fieldOf(first, "ok"), true);
  assert.equal(fieldOf(first, "steps", 0, "created"), true);
  const { animators, selectors, opacity } = animatorParts(title);
  assert.equal(animators.children.length, 1);
  assert.equal(selectors.children.length, 1);
  assert.equal(opacity.value, 0);
  const second = ensureOpacityAnimator(apply, "animator-2", 50);
  assert.equal(fieldOf(second, "ok"), true);
  assert.equal(fieldOf(second, "steps", 0, "created"), false);
  assert.equal(animators.children.length, 1);
  assert.equal(opacity.value, 50);
});

test("apply_plan reacquires a visible Text Animator property and adds a live leaf instead of writing a hidden one", () => {
  const { apply, title } = loadApplyPlan();
  const created = ensureOpacityAnimator(apply, "animator-visible", 0);
  assert.equal(fieldOf(created, "ok"), true, "the visible tree leaf is used instead of the hidden/stale addProperty return value");
  const { properties, opacity } = animatorParts(title);
  opacity.isHidden = true;
  const rejected = ensureOpacityAnimator(apply, "animator-hidden", 50);
  assert.equal(fieldOf(rejected, "ok"), true, "a hidden leaf is never written; the documented addProperty adds a live one");
  assert.equal(opacity.value, 0);
  const live = lastChildNamed(properties, "ADBE Text Opacity");
  assert.equal(live.value, 50);
  properties.addProperty = () => null;
  live.isHidden = true;
  assertRefused(ensureOpacityAnimator(apply, "animator-still-hidden", 25), "TEXT_ANIMATOR_PROPERTY_HIDDEN");
});

function addPlaceholderOpacityToNewAnimators(animators: FakeProperty): void {
  const addAnimator = animators.addProperty.bind(animators);
  animators.addProperty = (matchName) => {
    const animator = addAnimator(matchName);
    const properties = animator?.children.find((property) => property.matchName === "ADBE Text Animator Properties");
    if (properties) {
      const placeholder = new FakeProperty("ADBE Text Opacity", "Opacity", [], 100, true);
      placeholder.setValue = () => {
        throw new Error("Can not \"set value\" with this property, because the property or a parent property is hidden.");
      };
      properties.children.push(placeholder);
    }
    return animator;
  };
}

test("apply_plan skips an AE 26 placeholder Text Opacity leaf that rejects writes and adds the real property", () => {
  const { apply, title } = loadApplyPlan();
  const animators = textAnimatorsGroup(title);
  addPlaceholderOpacityToNewAnimators(animators);
  const reply = ensureOpacityAnimator(apply, "animator-placeholder", 0);
  assertApplied(reply);
  const properties = childNamed(childAt(animators, 0), "ADBE Text Animator Properties");
  assert.equal(lastChildNamed(properties, "ADBE Text Opacity").value, 0);
});

function hideParentOfNewOpacity(animator: FakeProperty): void {
  const properties = childNamed(animator, "ADBE Text Animator Properties");
  properties.isHidden = true;
  const addOpacity = properties.addProperty.bind(properties);
  properties.addProperty = (matchName) => {
    const returned = addOpacity(matchName);
    const live = childNamed(properties, "ADBE Text Opacity");
    live.isHidden = false;
    live.canSetValue = true;
    live.setValue = () => {
      throw new Error("Can not set value because a parent property is hidden.");
    };
    return returned;
  };
}

function hideOpacityParentOfNewAnimators(animators: FakeProperty): void {
  const addAnimator = animators.addProperty.bind(animators);
  animators.addProperty = (matchName) => {
    const animator = addAnimator(matchName);
    if (animator) hideParentOfNewOpacity(animator);
    return animator;
  };
}

test("apply_plan treats a visible writable-looking Text Animator leaf whose hidden parent rejects setValue as a partial mutation risk", () => {
  const { apply, title } = loadApplyPlan();
  hideOpacityParentOfNewAnimators(textAnimatorsGroup(title));
  const rejected = ensureOpacityAnimator(apply, "animator-hidden-parent", 0);
  assertRefused(rejected, "PROPERTY_WRITE_FAILED");
  assert.match(textAt(rejected, "error", "message"), /parent property is hidden/);
  assert.equal(fieldOf(rejected, "mayHaveMutated"), true);
  assert.equal(fieldOf(rejected, "mutationState"), "mutation-unknown");
});

const ANIMATOR_TARGET = { compositionId: "comp-main", layerId: "layer-anim" } as const;
const PERCENT_OFFSET_PATH = "ADBE Text Properties/ADBE Text Animators/ADBE Text Animator/ADBE Text Selectors/ADBE Text Selector/ADBE Text Percent Offset";

function animatorProperty(path: string, value: JsonValue): JsonObject {
  return { path: `ADBE Text Animator Properties/${path}`, value };
}

function revealAnimatorOperations(): ReadonlyArray<JsonObject> {
  return [
    {
      operation: "add_text_animator",
      ...ANIMATOR_TARGET,
      newAnimatorId: "__new__:a",
      name: "Reveal",
      selectorMatchName: "ADBE Text Selector",
      writes: [
        animatorProperty("ADBE Text Position 3D", [0, 40, 0]),
        { path: "ADBE Text Selectors/ADBE Text Selector/ADBE Text Range Advanced/ADBE Text Selector Mode", value: 2 },
      ],
      animations: [{ path: "ADBE Text Selectors/ADBE Text Selector/ADBE Text Percent Offset", keyframes: [{ time: 0, value: -100 }, { time: 1, value: 100 }] }],
    },
    {
      operation: "update_text_animator",
      ...ANIMATOR_TARGET,
      animatorId: "__new__:a",
      selectorMatchName: "ADBE Text Selector",
      writes: [animatorProperty("ADBE Text Opacity", 0)],
      animations: [],
    },
  ];
}

function assertRevealAnimatorBuilt(reply: JsonObject, animators: FakeProperty): void {
  assertApplied(reply);
  assert.equal(fieldOf(reply, "steps", 0, "animatorId"), "animator:1");
  assert.equal(fieldOf(reply, "steps", 0, "containerPath"), "ADBE Text Properties/ADBE Text Animators/ADBE Text Animator");
  const animator = childAt(animators, 0);
  assert.equal(animator.name, "Reveal");
  const properties = childAt(animator, 1);
  assert.deepEqual(plain(properties.children.map((property) => [property.matchName, property.value])), [["ADBE Text Position 3D", [0, 40, 0]], ["ADBE Text Opacity", 0]]);
  const selector = childAt(childAt(animator, 0), 0);
  assert.equal(childAt(selector, 2).numKeys, 2);
  assert.equal(childAt(childAt(selector, 3), 0).value, 2);
  assert.deepEqual(fieldOf(reply, "steps", 0, "animations", 0), {
    path: PERCENT_OFFSET_PATH,
    keyframes: 2,
    keyframeMode: "reject",
    afterKeys: 2,
    keys: { count: 2, keys: [{ time: 0, value: -100 }, { time: 1, value: 100 }], truncated: false },
  }, "the host reads back every key it wrote");
}

function assertExpressionAnimatorBuilt(apply: PlanApply, animators: FakeProperty): void {
  const reply = applyPlan(apply, "animator-expression", [{
    operation: "add_text_animator",
    ...ANIMATOR_TARGET,
    newAnimatorId: "__new__:b",
    selectorMatchName: "ADBE Text Expressible Selector",
    amountExpression: "textIndex * 10",
    writes: [animatorProperty("ADBE Text Fill Color", [1, 0, 0])],
    animations: [],
  }]);
  assertApplied(reply);
  assert.equal(fieldOf(reply, "steps", 0, "animatorId"), "animator:2");
  assert.equal(fieldOf(reply, "steps", 0, "containerPath"), "ADBE Text Properties/ADBE Text Animators/ADBE Text Animator#2");
  const second = childAt(animators, 1);
  assert.deepEqual(plain(childAt(childAt(second, 1), 0).value), [1, 0, 0, 1]);
  assert.equal(childAt(childAt(childAt(second, 0), 0), 1).expression, "textIndex * 10");
}

function assertInvalidAnimatorWriteRefusedBeforeMutation(apply: PlanApply, beginCalls: ReadonlyArray<string>): void {
  const beginsBefore = beginCalls.length;
  const evil = applyPlan(apply, "animator-evil", [{
    operation: "add_text_animator",
    ...ANIMATOR_TARGET,
    newAnimatorId: "__new__:c",
    selectorMatchName: "ADBE Text Selector",
    writes: [animatorProperty("Evil", 1)],
    animations: [],
  }]);
  assert.equal(fieldOf(evil, "error", "code"), "INVALID_VALUE");
  assert.equal(beginCalls.length, beginsBefore, "rejected before any mutation");
  const missing = applyPlan(apply, "animator-missing", [{
    operation: "update_text_animator",
    ...ANIMATOR_TARGET,
    animatorId: "animator:9",
    selectorMatchName: "ADBE Text Selector",
    writes: [animatorProperty("ADBE Text Opacity", 1)],
    animations: [],
  }]);
  assert.equal(fieldOf(missing, "error", "code"), "TARGET_NOT_FOUND");
}

test("add_text_animator adds indexed animators, properties, selector settings, and keys at #n paths", () => {
  const { apply, animators, calls } = loadExtended();
  assertRevealAnimatorBuilt(applyPlan(apply, "animator-reveal", revealAnimatorOperations()), animators);
  assertExpressionAnimatorBuilt(apply, animators);
  assertInvalidAnimatorWriteRefusedBeforeMutation(apply, calls.begin);
});

const PLACEHOLDER_HIDDEN_MESSAGE = "Can not \"set value\" with this property, because the property or a parent property is hidden.";

function placeholderLeaf(matchName: string, value: JsonValue): FakeProperty {
  const placeholder = leaf(matchName, value);
  placeholder.setValue = () => {
    throw new Error(PLACEHOLDER_HIDDEN_MESSAGE);
  };
  placeholder.setValueAtTime = () => {
    throw new Error(PLACEHOLDER_HIDDEN_MESSAGE.replace("set value", "set value at time"));
  };
  return placeholder;
}

function appendPlaceholderLeavesToNewAnimators(animators: FakeProperty): void {
  const addAnimator = animators.addProperty.bind(animators);
  animators.addProperty = (matchName) => {
    const animator = addAnimator(matchName);
    if (animator) childAt(animator, 1).children.push(placeholderLeaf("ADBE Text Position 3D", [0, 0, 0]), placeholderLeaf("ADBE Text Opacity", 100));
    return animator;
  };
}

function assertPlaceholderSkippedByAdd(apply: PlanApply, animators: FakeProperty): void {
  const added = applyPlan(apply, "placeholder-add", [{
    operation: "add_text_animator",
    ...ANIMATOR_TARGET,
    newAnimatorId: "__new__:a",
    selectorMatchName: "ADBE Text Selector",
    writes: [animatorProperty("ADBE Text Position 3D", [0, 40, 0])],
    animations: [],
  }]);
  assertApplied(added);
  assert.deepEqual(
    plain(childAt(childAt(animators, 0), 1).children.map((property) => [property.matchName, property.value])),
    [["ADBE Text Position 3D", [0, 0, 0]], ["ADBE Text Opacity", 100], ["ADBE Text Position 3D", [0, 40, 0]]],
    "the placeholder stays untouched; the real leaf is appended and written",
  );
}

function assertPlaceholderSkippedByUpdate(apply: PlanApply, properties: FakeProperty): void {
  const updated = applyPlan(apply, "placeholder-update", [{
    operation: "update_text_animator",
    ...ANIMATOR_TARGET,
    animatorId: "animator:1",
    selectorMatchName: "ADBE Text Selector",
    writes: [animatorProperty("ADBE Text Opacity", 0)],
    animations: [],
  }]);
  assertApplied(updated);
  assert.equal(lastChildNamed(properties, "ADBE Text Opacity").value, 0);
}

function assertPlaceholderSkippedByAnimate(apply: PlanApply, properties: FakeProperty): void {
  const animated = applyPlan(apply, "placeholder-animate", [{
    operation: "animate_property",
    ...ANIMATOR_TARGET,
    propertyPath: "ADBE Text Properties/ADBE Text Animators/ADBE Text Animator/ADBE Text Animator Properties/ADBE Text Position 3D",
    keyframes: [{ time: 0, value: [0, 40, 0] }, { time: 1, value: [0, 0, 0] }],
  }]);
  assertApplied(animated);
  const positions = childrenNamed(properties, "ADBE Text Position 3D");
  assert.equal(positions.length, 2, "no third leaf: the written one is reused");
  assert.equal(lastChildNamed(properties, "ADBE Text Position 3D").numKeys, 2);
  assert.equal(childNamed(properties, "ADBE Text Position 3D").numKeys, 0);
}

function assertStuckPlaceholderNamed(apply: PlanApply, properties: FakeProperty): void {
  properties.addProperty = () => null;
  const stuck = applyPlan(apply, "placeholder-stuck", [{
    operation: "update_text_animator",
    ...ANIMATOR_TARGET,
    animatorId: "animator:1",
    selectorMatchName: "ADBE Text Selector",
    writes: [animatorProperty("ADBE Text Fill Color", [1, 0, 0])],
    animations: [],
  }]);
  assertRefused(stuck, "TEXT_ANIMATOR_UNSUPPORTED");
}

test("text animator writes skip AE 26 placeholder leaves for add_text_animator, update_text_animator, and animate_property", () => {
  const { apply, animators } = loadExtended();
  appendPlaceholderLeavesToNewAnimators(animators);
  assertPlaceholderSkippedByAdd(apply, animators);
  const properties = childAt(childAt(animators, 0), 1);
  assertPlaceholderSkippedByUpdate(apply, properties);
  assertPlaceholderSkippedByAnimate(apply, properties);
  assertStuckPlaceholderNamed(apply, properties);
});

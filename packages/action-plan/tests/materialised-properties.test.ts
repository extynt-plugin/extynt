// Property materialisation: which paths and roles a plan grounds on layers, animators and effects it creates, and which stay refused.
import assert from "node:assert/strict";
import test from "node:test";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { ANCHOR_PATH, animatorPath, BLUR_CONTROL_PATH, BLUR_EFFECT_PATH, EMPTY_SNAPSHOT, expressionOn, newComposition, newTarget, newTextLayer, target } from "./fixtures.js";
import { GENEROUS_BOUNDS, refusal, verdict } from "./plan-builders.js";

const created = { snapshot: EMPTY_SNAPSHOT, bounds: GENEROUS_BOUNDS };
const SOURCE_TEXT = "ADBE Text Properties/ADBE Text Document";
const ORIENTATION = "ADBE Transform Group/ADBE Orientation";

function onCreated(...operations: readonly JsonValue[]): string {
  return verdict([newComposition, newTextLayer, ...operations], created);
}

function animateAt(propertyPath: string, keyframes: JsonValue, extra: JsonObject = {}): JsonObject {
  return { type: "animate_property", target: newTarget({ propertyPath }), keyframes, ...extra };
}

const animateAnchor = animateAt(ANCHOR_PATH, [{ time: 0, value: [0, 0] }, { time: 12, value: [10, 20] }]);

test("animate_property accepts the Anchor Point role on a layer the plan creates", () => {
  assert.equal(onCreated(animateAnchor), "ok");
});

test("an expression resolves the typed role an earlier operation keyed, and the role alone", () => {
  assert.equal(onCreated(animateAnchor, expressionOn(ANCHOR_PATH)), "ok");
  assert.equal(onCreated(expressionOn(ANCHOR_PATH)), "ok");
});

test("the 3-component anchor shape is accepted when the role is carried", () => {
  const roleCarried = animateAt(ANCHOR_PATH, [{ time: 0, value: [0, 0, 0] }, { time: 12, value: [10, 20, 30] }], { role: "transform.anchor" });
  assert.equal(onCreated(roleCarried), "ok");
});

test("a property path neither in the role table nor materialised by the plan stays TARGET_NOT_FOUND", () => {
  assert.equal(onCreated(expressionOn(ORIENTATION)), "TARGET_NOT_FOUND");
  assert.equal(onCreated(animateAt(ORIENTATION, [{ time: 0, value: [0, 0, 0] }])), "TARGET_NOT_FOUND");
});

test("a native write at a path outside the role table is an invalid target", () => {
  const write = { type: "set_layer_property", target: newTarget(), role: "transform.orientation", propertyPath: ORIENTATION, value: [0, 0, 0] } satisfies JsonObject;
  assert.equal(onCreated(write), "INVALID_TARGET");
});

test("an Anchor Point expression on a layer the plan does not create is still refused", () => {
  const missing = { type: "set_expression", target: { ...newTarget({ propertyPath: ANCHOR_PATH }), layerId: "layer-missing" }, enabled: true, source: "value" } satisfies JsonObject;
  assert.equal(verdict([newComposition, missing], created), "TARGET_NOT_FOUND");
});

const rangeSelector = { type: "range", settings: { start: 0, end: 100 } } satisfies JsonObject;
const positionPath = animatorPath("ADBE Text Animator", "ADBE Text Animator Properties/ADBE Text Position 3D");

function addAnimator(newAnimatorId: string, properties: JsonObject): JsonObject {
  return { type: "add_text_animator", target: newTarget(), newAnimatorId, properties, selector: rangeSelector };
}

test("set_expression resolves an animator property an earlier operation materialises", () => {
  assert.equal(onCreated(addAnimator("__new__:anim1", { position: [0, 0] }), expressionOn(positionPath)), "ok");
});

test("set_expression refuses an animator property no earlier operation declares and names it", () => {
  const result = refusal([newComposition, newTextLayer, addAnimator("__new__:anim2", { opacity: 50 }), expressionOn(positionPath)], created);
  assert.equal(result.code, "TARGET_NOT_FOUND");
  assert.match(result.message, /ADBE Text Position 3D/);
});

test("ensure_text_animator grounds its own opacity property and never a second animator's ordinal", () => {
  const ensure = { type: "ensure_text_animator", target: newTarget(), role: "text.opacity", value: 100 } satisfies JsonObject;
  const opacity = animatorPath("ADBE Text Animator", "ADBE Text Animator Properties/ADBE Text Opacity");
  const second = animatorPath("ADBE Text Animator#2", "ADBE Text Selectors/ADBE Text Selector/ADBE Text Percent Start");
  assert.equal(onCreated(ensure, expressionOn(opacity)), "ok");
  assert.equal(onCreated(ensure, expressionOn(second)), "TARGET_NOT_FOUND");
});

test("an earlier native write is part of the same resolution an expression uses", () => {
  const staticAnchor = { type: "set_layer_property", target: newTarget(), role: "transform.anchor", propertyPath: ANCHOR_PATH, value: [10, 20] } satisfies JsonObject;
  assert.equal(onCreated(staticAnchor, expressionOn(ANCHOR_PATH)), "ok");
});

test("a text create_layer grounds Source Text for a later expression and for keys", () => {
  assert.equal(onCreated(expressionOn(SOURCE_TEXT)), "ok");
  assert.equal(onCreated(animateAt(SOURCE_TEXT, [{ time: 0, value: "Directed by" }])), "ok");
});

test("only an earlier text create_layer grounds Source Text", () => {
  const solid = { type: "create_layer", target: newTarget(), layerType: "solid", name: "Plate", color: [1, 0, 0, 1] } satisfies JsonObject;
  assert.equal(verdict([newComposition, expressionOn(SOURCE_TEXT), newTextLayer], created), "TARGET_NOT_FOUND");
  assert.equal(verdict([newComposition, solid, expressionOn(SOURCE_TEXT)], created), "TARGET_NOT_FOUND");
  assert.equal(onCreated(expressionOn("ADBE Text Properties/ADBE Text Path Options")), "TARGET_NOT_FOUND");
});

test("an observed text layer grounds its Source Text without a plan producer", () => {
  const observed = { type: "set_expression", target: { ...target, propertyPath: SOURCE_TEXT }, source: "value", enabled: true } satisfies JsonObject;
  assert.equal(verdict([observed]), "ok");
});

const controlExpression = (targetPath: JsonObject, source = "time * 10"): JsonObject => ({ type: "set_expression", target: { ...target, ...targetPath }, source, enabled: true });
const blur = { effectPath: BLUR_EFFECT_PATH, propertyPath: BLUR_CONTROL_PATH } satisfies JsonObject;

test("set_expression accepts the effect control a snapshot shows", () => {
  assert.equal(verdict([controlExpression(blur)], { bounds: GENEROUS_BOUNDS }), "ok");
});

test("set_expression leaves a well-formed control the snapshot does not show to the host", () => {
  const unseen = { effectPath: BLUR_EFFECT_PATH, propertyPath: `${BLUR_EFFECT_PATH}/ADBE Gaussian Blur 2-9999` } satisfies JsonObject;
  const rig = { effectPath: "ADBE Effect Parade/Duik Controller", propertyPath: "ADBE Effect Parade/Duik Controller/ADBE Slider Control-0001" } satisfies JsonObject;
  assert.equal(verdict([controlExpression(unseen)], { bounds: GENEROUS_BOUNDS }), "ok");
  assert.equal(verdict([controlExpression(rig)], { bounds: GENEROUS_BOUNDS }), "ok");
});

test("set_expression refuses a control path that can never resolve on the host", () => {
  const bracket = { effectPath: BLUR_EFFECT_PATH, propertyPath: `${BLUR_EFFECT_PATH}/[#1]/Blurriness` } satisfies JsonObject;
  const outside = { effectPath: BLUR_EFFECT_PATH, propertyPath: "ADBE Transform Group/ADBE Position" } satisfies JsonObject;
  const foreign = { effectPath: "ADBE Effect Parade/ADBE Fill", propertyPath: BLUR_CONTROL_PATH } satisfies JsonObject;
  assert.equal(verdict([controlExpression(bracket)], { bounds: GENEROUS_BOUNDS }), "TARGET_NOT_FOUND");
  assert.equal(verdict([controlExpression(outside)], { bounds: GENEROUS_BOUNDS }), "INVALID_TARGET");
  assert.equal(verdict([controlExpression(foreign)], { bounds: GENEROUS_BOUNDS }), "INVALID_TARGET");
});

test("set_expression needs an exact control path and bounds its source before the host sees it", () => {
  const bare = { type: "set_expression", target: { ...target, effectPath: BLUR_EFFECT_PATH }, source: "value", enabled: true } satisfies JsonObject;
  const bounds = { maxOperations: 1, maxExpressionLength: 32 } satisfies JsonObject;
  assert.equal(verdict([bare], { bounds: GENEROUS_BOUNDS }), "INVALID_OPERATION");
  assert.equal(verdict([controlExpression(blur, "x".repeat(33))], { bounds }), "INVALID_OPERATION");
  assert.equal(verdict([controlExpression(blur, "x".repeat(32))], { bounds }), "ok");
});

const ensureBlur = { type: "ensure_effect", target: newTarget({ effectPath: BLUR_EFFECT_PATH }), capabilityId: "adobe.gaussian-blur", effectMatchName: "ADBE Gaussian Blur 2", effectPath: BLUR_EFFECT_PATH } satisfies JsonObject;
const createdControl = { type: "set_expression", target: newTarget({ effectPath: BLUR_EFFECT_PATH, propertyPath: BLUR_CONTROL_PATH }), source: "value", enabled: true } satisfies JsonObject;

test("set_expression accepts an effect control an earlier ensure_effect materialises", () => {
  assert.equal(onCreated(ensureBlur, createdControl), "ok");
});

test("set_expression refuses a control no earlier ensure_effect for that effect materialises", () => {
  const fillPath = "ADBE Effect Parade/ADBE Fill";
  const ensureFill = { type: "ensure_effect", target: newTarget({ effectPath: fillPath }), capabilityId: "adobe.fill", effectMatchName: "ADBE Fill", effectPath: fillPath } satisfies JsonObject;
  assert.equal(onCreated(createdControl), "TARGET_NOT_FOUND");
  assert.equal(onCreated(ensureFill, createdControl), "TARGET_NOT_FOUND");
});

const RAW_GAIN = "ADBE Effect Parade/ADBE Gamma/Pedestal/Gain2";
const ESCAPED_GAIN = "ADBE Effect Parade/ADBE Gamma%2FPedestal%2FGain2";

function gainPlan(effectPath: string): readonly JsonValue[] {
  const ensure = { type: "ensure_effect", target: newTarget({ effectPath }), capabilityId: "adobe.gamma-pedestal-gain", effectMatchName: "ADBE Gamma/Pedestal/Gain2", effectPath } satisfies JsonObject;
  const expression = { type: "set_expression", target: newTarget({ effectPath, propertyPath: `${effectPath}/ADBE Gamma%2FPedestal%2FGain2-0001` }), source: "value", enabled: true } satisfies JsonObject;
  return [newComposition, newTextLayer, ensure, expression];
}

test("set_expression refuses the raw matchName spelling the host cannot resolve", () => {
  assert.equal(verdict(gainPlan(RAW_GAIN), created), "INVALID_TARGET");
});

test("set_expression resolves the escaped spelling the property tree uses", () => {
  assert.equal(verdict(gainPlan(ESCAPED_GAIN), created), "ok");
});

const inlineExpression = { source: "value", enabled: true } satisfies JsonObject;

test("an inline expression field stays refused inside animate_control", () => {
  const animate = { type: "animate_control", target: { ...target, ...blur }, role: "blur.amount", effectMatchName: "ADBE Gaussian Blur 2", keyframes: [{ time: 0, value: 10 }], expression: inlineExpression } satisfies JsonObject;
  assert.equal(verdict([animate]), "EXPRESSIONS_UNSUPPORTED");
});

test("an inline expression field stays refused inside animate_property", () => {
  const animate = { type: "animate_property", target: { ...target, propertyPath: "ADBE Transform Group/ADBE Position" }, keyframes: [{ time: 0, value: [0, 0] }], expression: inlineExpression } satisfies JsonObject;
  assert.equal(verdict([animate]), "EXPRESSIONS_UNSUPPORTED");
});

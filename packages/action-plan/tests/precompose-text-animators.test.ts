// precompose_layers and the text animator operations: placeholders, layer-type rules and selector settings.
import test from "node:test";
import type { JsonObject } from "@extynt/decode";
import { compositionTarget, footageTarget, target } from "./fixtures.js";
import { assertOperations, assertSequences } from "./plan-builders.js";

function precompose(layerIds: readonly string[], extra: JsonObject = {}): JsonObject {
  return { type: "precompose_layers", target: compositionTarget, layerIds: [...layerIds], name: "Nested", newCompositionId: "__new__:precomp", newLayerId: "__new__:precomp-layer", ...extra };
}

function addAnimator(extra: JsonObject): JsonObject {
  return { type: "add_text_animator", target, newAnimatorId: "__new__:anim0", ...extra };
}

test("precompose_layers is valid with several layers and newCompositionId/newLayerId placeholders", () => {
  assertOperations([
    ["ok", precompose(["layer-title", "layer-footage"])],
    ["ok", precompose(["layer-title"], { moveAllAttributes: false })],
  ]);
});

test("precompose_layers refuses moveAllAttributes false with several layers and unknown layers", () => {
  assertOperations([
    ["INVALID_VALUE", precompose(["layer-title", "layer-footage"], { moveAllAttributes: false })],
    ["TARGET_NOT_FOUND", precompose(["no-such-layer"])],
  ]);
});

test("precompose_layers rejects later operations targeting the moved layers", () => {
  const rename = { type: "set_layer_name", target, name: "After precomp" } satisfies JsonObject;
  assertSequences([["PRECOMPOSED_LAYER_REFERENCED", [precompose(["layer-title"]), rename]]]);
});

test("precompose_layers later operations on newLayerId are accepted", () => {
  const rename = { type: "set_layer_name", target: { ...target, layerId: "__new__:precomp-layer" }, name: "After precomp" } satisfies JsonObject;
  assertSequences([["ok", [precompose(["layer-title"]), rename]]]);
});

test("add_text_animator is valid with properties and keyframes on a text layer", () => {
  const animator = addAnimator({ properties: { position: [10, 0, 0] }, selector: { type: "range", settings: { start: 0, end: 50 } }, keyframes: { "selector.offset": [{ time: 0, value: -100 }, { time: 1, value: 100 }] } });
  assertOperations([["ok", animator]]);
});

test("add_text_animator rejects an unknown property, a non-text layer and a missing payload", () => {
  assertOperations([
    ["INVALID_VALUE", addAnimator({ properties: { unknown: 10 } })],
    ["INVALID_TARGET", { ...addAnimator({ properties: { position: [10, 0, 0] } }), target: footageTarget }],
    ["INVALID_OPERATION", addAnimator({})],
  ]);
});

test("update_text_animator requires animator:N or an earlier placeholder", () => {
  const update = (animatorId: string): JsonObject => ({ type: "update_text_animator", target, animatorId, properties: { opacity: 50 } });
  assertOperations([["ok", update("animator:1")], ["TARGET_NOT_FOUND", update("animator:0")]], { bounds: { maxOperations: 2 } });
  assertSequences([["ok", [addAnimator({ properties: { position: [0, 0, 0] } }), update("__new__:anim0")]]], { bounds: { maxOperations: 2 } });
});

test("text animator wiggly and expression selector settings validate", () => {
  const wiggly = addAnimator({ selector: { type: "wiggly", settings: { wigglesPerSecond: 10, maxAmount: 5 } }, properties: { opacity: 50 } });
  const expression = addAnimator({ selector: { type: "expression", settings: { amount: 10 }, amountExpression: "Math.random() * 100" }, properties: { opacity: 50 } });
  const misplaced = addAnimator({ selector: { type: "range", amountExpression: "bad" }, properties: { opacity: 50 } });
  assertOperations([["ok", wiggly], ["ok", expression], ["INVALID_VALUE", misplaced]]);
});

test("a declared maxExpressionLength bounds a selector amountExpression", () => {
  const selecting = (amountExpression: string): JsonObject => addAnimator({ properties: { opacity: 50 }, selector: { type: "expression", amountExpression } });
  assertOperations([["INVALID_VALUE", selecting("value * 2")]], { bounds: { maxOperations: 1, maxExpressionLength: 1 } });
  assertOperations([["INVALID_VALUE", selecting("xyz")], ["ok", selecting("xy")]], { bounds: { maxOperations: 1, maxExpressionLength: 2 } });
  assertOperations([["ok", selecting("Math.random() * 100")]], { bounds: { maxOperations: 1, maxExpressionLength: 64 } });
});

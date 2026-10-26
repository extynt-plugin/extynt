// Effect identity: ensure_effect names one effect through matchName, path and capability, and controls address a second instance by path alone.
import assert from "node:assert/strict";
import test from "node:test";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { BLUR_CONTROL_PATH, BLUR_EFFECT_PATH, target } from "./fixtures.js";
import { assertOperations, assertSequences, refusal } from "./plan-builders.js";

function ensure(capabilityId: string, effectMatchName: string, effectPath: string): JsonObject {
  return { type: "ensure_effect", target: { ...target, effectPath }, capabilityId, effectMatchName, effectPath };
}

function hostEnsure(effectMatchName: string, effectPath: string): JsonObject {
  return ensure(`host:${effectMatchName}`, effectMatchName, effectPath);
}

function animateBlur(keyframes: readonly JsonValue[]): JsonObject {
  return { type: "animate_control", target: { ...target, effectPath: BLUR_EFFECT_PATH, propertyPath: BLUR_CONTROL_PATH }, role: "blur.amount", effectMatchName: "ADBE Gaussian Blur 2", keyframes: [...keyframes] };
}

test("animate_control accepts the keyframe values set_effect_control accepts", () => {
  assertOperations([
    ["ok", animateBlur([{ time: 0, value: 20 }])],
    ["ok", animateBlur([{ time: 0, value: 20 }, { time: 1, value: 40 }])],
    ["ok", animateBlur([{ time: 0, value: [0.1, 0.2, 0.3, 1] }])],
  ]);
});

test("animate_control rejects the keyframe values set_effect_control refuses", () => {
  const bad: readonly JsonValue[] = [{}, null, "50", [1, 2, 3, 4, 5]];
  assertOperations(bad.map((value): readonly [string, JsonObject] => ["INVALID_VALUE", animateBlur([{ time: 0, value }])]));
});

test("ensure_effect rejects an empty matchName or an empty effect path segment", () => {
  assertOperations([
    ["INVALID_OPERATION", ensure("host:", "", "ADBE Effect Parade/")],
    ["INVALID_OPERATION", ensure("host:ADBE Tint", "ADBE Tint", "ADBE Effect Parade/")],
    ["ok", hostEnsure("ADBE Tint", "ADBE Effect Parade/ADBE Tint")],
  ]);
});

test("ensure_effect rejects an effectPath that names a different effect than effectMatchName", () => {
  assertOperations([
    ["ok", hostEnsure("ADBE Tint", "ADBE Effect Parade/ADBE Tint")],
    ["INVALID_OPERATION", hostEnsure("ADBE Tint", "ADBE Effect Parade/ADBE Gaussian Blur 2")],
    ["INVALID_OPERATION", ensure("adobe.gaussian-blur", "ADBE Gaussian Blur 2", "ADBE Effect Parade/ADBE Tint")],
  ]);
});

test("ensure_effect accepts escaped segments and ordinals the host accepts", () => {
  assertOperations([
    ["ok", hostEnsure("ADBE Gamma/Pedestal/Gain2", "ADBE Effect Parade/ADBE Gamma%2FPedestal%2FGain2")],
    ["ok", hostEnsure("ADBE Tint", "ADBE Effect Parade/ADBE Tint#2")],
    ["ok", hostEnsure("ADBE Tint#2", "ADBE Effect Parade/ADBE Tint%232#3")],
    ["ok", hostEnsure("ADBE Gamma/Pedestal/Gain2", "ADBE Effect Parade/ADBE Gamma/Pedestal/Gain2")],
  ]);
});

test("ensure_effect refuses an ordinal the host refuses", () => {
  assertOperations([
    ["INVALID_OPERATION", hostEnsure("ADBE Tint", "ADBE Effect Parade/ADBE Tint#1")],
    ["INVALID_OPERATION", hostEnsure("ADBE Tint", "ADBE Effect Parade/ADBE Tint#2 extra")],
  ]);
});

const second = "ADBE Effect Parade/ADBE Tint#2";

function tintControl(effectMatchName: string): JsonObject {
  return { type: "set_effect_control", target: { ...target, effectPath: second, propertyPath: `${second}/ADBE Tint-0003` }, effectMatchName, value: 0.5 };
}

test("a control on a second instance of an effect keeps the bare matchName", () => {
  assertSequences([["ok", [hostEnsure("ADBE Tint", second), tintControl("ADBE Tint")]]], { bounds: { maxOperations: 2 } });
});

test("the ordinal never rides in the matchName", () => {
  const refused = refusal([hostEnsure("ADBE Tint", second), tintControl("ADBE Tint#2")], { bounds: { maxOperations: 2 } });
  assert.equal(refused.code, "INVALID_OPERATION");
  assert.match(refused.message, /only effectPath carries "#N"/);
  assertSequences([["INVALID_OPERATION", [hostEnsure("ADBE Tint#2", second)]]], { bounds: { maxOperations: 2 } });
});

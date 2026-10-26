// Turns the rows and local effect facts of a native page into effect and control observations, rejecting what does not fit its INVALID_* code.
import { boolean, decode, decodeOrCode, fallback, jsonObject, jsonValue, literal, map, object, optional, string } from "@extynt/decode";
import type { Decoder, Infer, JsonObject } from "@extynt/decode";
import { collectionDescriptor, collectionNativeDescriptor, collectionValue } from "./collection-types.js";
import type { CollectionNativeDescriptor } from "./collection-types.js";
import type { CollectionTarget } from "./collection-request.js";
import { plainRelativePath, validateEffectContext } from "./effect-context.js";
import type { EffectContext } from "./effect-context.js";
import { countOrNull, indicesOrEmpty, numberOrNull, textOr } from "./native-page.js";
import type { ObservedPage } from "./native-page.js";
import type { ControlObservation, CurrentControl, EffectObservation } from "./graph-control-types.js";

const LOCAL_CODE = "INVALID_LOCAL_EFFECT_OBSERVATION";
const BLUR_MATCH_NAME = "ADBE Gaussian Blur 2";
const descriptorOf = fallback(jsonObject, {});
const rowName = object({ name: textOr("") });
const rowFacts = object({ effectContext: optional(jsonValue), name: textOr("") });
const staticRow = object({ valueState: literal("observed-static") });
const unitsText: Decoder<string | null> = fallback(map(string(), (text) => (text.length <= 4096 ? text : "")), null);
const compositionFacts = object({ id: textOr(""), itemIndex: countOrNull });
const layerFacts = object({ id: textOr(""), index: countOrNull });
const localFacts = object({
  effectIndex: countOrNull, effectMatchName: fallback(literal(BLUR_MATCH_NAME), undefined), effectEnabled: fallback(boolean(), null),
  keyframeCount: fallback(literal(0), undefined), expressionEnabled: fallback(literal(false), undefined), expression: fallback(literal(""), undefined),
  value: numberOrNull, minimum: numberOrNull, maximum: numberOrNull, canSetValue: fallback(literal(true), undefined),
  unitsText, isTimeVarying: fallback(boolean(), null), propertyIndices: indicesOrEmpty,
});
const NO_COMPOSITION: Infer<typeof compositionFacts> = { id: "", itemIndex: null };
const NO_LAYER: Infer<typeof layerFacts> = { id: "", index: null };
const NO_LOCAL: Infer<typeof localFacts> = {
  effectIndex: null, effectMatchName: undefined, effectEnabled: null, keyframeCount: undefined, expressionEnabled: undefined, expression: undefined,
  value: null, minimum: null, maximum: null, canSetValue: undefined, unitsText: null, isTimeVarying: null, propertyIndices: [],
};
const metadataFacts = object({ composition: fallback(compositionFacts, NO_COMPOSITION), layer: fallback(layerFacts, NO_LAYER) });
const NO_METADATA: Infer<typeof metadataFacts> = { composition: NO_COMPOSITION, layer: NO_LAYER };
const blurFacts = object({ metadata: fallback(metadataFacts, NO_METADATA), localEffect: fallback(localFacts, NO_LOCAL) });
const valuePage = object({ effectContext: optional(jsonValue), nativeDescriptor: optional(descriptorOf) });

function flag(value: number | null): boolean | null { return value === null ? null : value === 1; }

function effectFromContext(context: EffectContext, target: CollectionTarget): EffectObservation {
  return {
    compositionId: target.compositionId ?? "", layerId: target.layerId ?? "", itemIndex: target.itemIndex ?? null, layerIndex: target.layerIndex ?? null,
    effectIndex: context.effectIndex, matchName: context.effectMatchName, name: context.effectName, enabled: context.effectEnabled,
  };
}

function currentFromDescriptor(descriptor: CollectionNativeDescriptor): CurrentControl {
  return {
    valueType: descriptor.valueType, value: null, minimum: descriptor.minimum, maximum: descriptor.maximum, units: descriptor.units,
    keyframeCount: descriptor.keyframeCount, expressionEnabled: flag(descriptor.expressionEnabled), expressionPresent: flag(descriptor.expressionPresent),
    isTimeVarying: flag(descriptor.isTimeVarying), canSetValue: flag(descriptor.canSetValue),
  };
}

/** The effects a properties page shows and the leaf controls it lists, each with the descriptor facts it carries. */
export function descriptorControls(target: CollectionTarget, rows: readonly JsonObject[]): { effects: EffectObservation[]; controls: ControlObservation[] } {
  const effects: EffectObservation[] = [], controls: ControlObservation[] = [];
  for (const row of rows) {
    const descriptor = collectionDescriptor(row), facts = decodeOrCode(rowFacts, row, LOCAL_CODE);
    const context = validateEffectContext(facts.effectContext, descriptor.indices);
    if (!context) continue;
    const effect = effectFromContext(context, target);
    effects.push(effect);
    if (context.relativeMatchNames.length === 0 || descriptor.children !== 0) continue;
    controls.push({
      effect, matchName: descriptor.matchName, name: facts.name, relativePath: context.relativePath, indexPath: descriptor.indices.join("/"),
      current: currentFromDescriptor(descriptor), coverage: "descriptor-only",
      canVaryOverTime: flag(descriptor.canVary), canSetExpression: flag(descriptor.canExpression),
    });
  }
  return { effects, controls };
}

function staticValue(rows: readonly JsonObject[], current: CurrentControl): boolean {
  const found = rows.find((row) => decode(staticRow, row).ok);
  if (!found) return false;
  if (current.keyframeCount === 0 && current.expressionEnabled === false) {
    const observed = collectionValue(found);
    current.value = observed.shape === "scalar" ? (observed.components[0] ?? null) : observed.components;
  }
  return true;
}

/** The one control a values page describes, with its static value when the page carries one. */
export function valueControls(target: CollectionTarget, page: ObservedPage): ControlObservation[] {
  const facts = decodeOrCode(valuePage, page.raw, LOCAL_CODE);
  const context = validateEffectContext(facts.effectContext, target.propertyIndices);
  if (!context) return [];
  const matchName = context.relativeMatchNames.at(-1), rows = page.rows;
  if (matchName === undefined) throw Error("INVALID_COLLECTION_EFFECT_CONTEXT");
  const current = currentFromDescriptor(collectionNativeDescriptor(facts.nativeDescriptor ?? {}));
  const hasStatic = staticValue(rows, current);
  return [{
    effect: effectFromContext(context, target), matchName, name: decodeOrCode(rowName, rows[0] ?? {}, LOCAL_CODE).name,
    relativePath: plainRelativePath(context.relativeMatchNames), indexPath: (target.propertyIndices ?? []).join("/"), current,
    coverage: hasStatic ? "static-value" : "key-values-only", canVaryOverTime: null, canSetExpression: null,
  }];
}

function refusedBlurState(local: Infer<typeof localFacts>): boolean {
  return local.keyframeCount !== 0 || local.expressionEnabled !== false || local.expression !== "" || local.canSetValue !== true;
}

function incompleteBlurRange(local: Infer<typeof localFacts>): boolean {
  return local.value === null || local.minimum === null || local.maximum === null || local.minimum > local.maximum;
}

function requireLiteralBlur(local: Infer<typeof localFacts>): void {
  if (refusedBlurState(local) || incompleteBlurRange(local)) throw Error(LOCAL_CODE);
}

function blurEffect(page: Infer<typeof blurFacts>): EffectObservation {
  const { composition, layer } = page.metadata, local = page.localEffect;
  if (!composition.id || !layer.id || local.effectIndex === null || local.effectIndex < 1 || local.effectMatchName !== BLUR_MATCH_NAME) throw Error(LOCAL_CODE);
  return {
    compositionId: composition.id, layerId: layer.id, itemIndex: composition.itemIndex, layerIndex: layer.index,
    effectIndex: local.effectIndex, matchName: BLUR_MATCH_NAME, name: "Gaussian Blur", enabled: local.effectEnabled,
  };
}

/** The Gaussian Blur effect and Blurriness control of a local blur page; a page that does not describe a plain literal blur is refused. */
export function blurControls(page: JsonObject): ControlObservation[] {
  const facts = decodeOrCode(blurFacts, page, LOCAL_CODE), local = facts.localEffect;
  const effect = blurEffect(facts);
  requireLiteralBlur(local);
  const current: CurrentControl = {
    valueType: "OneD", value: local.value, minimum: local.minimum, maximum: local.maximum, units: local.unitsText, keyframeCount: 0,
    expressionEnabled: false, expressionPresent: false, isTimeVarying: local.isTimeVarying, canSetValue: true,
  };
  return [{
    effect, matchName: "ADBE Gaussian Blur 2-0001", name: "Blurriness", relativePath: "ADBE Gaussian Blur 2-0001", indexPath: local.propertyIndices.join("/"),
    current, coverage: "static-value", canVaryOverTime: null, canSetExpression: null,
  }];
}

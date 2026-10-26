// Strict readers for the descriptor and value facts of one native collection row; a row that does not fit throws its INVALID_COLLECTION_* code.
import { NATIVE_PARAMETER_VALUE_TYPES } from "@extynt/project-graph";
import type { NativeParameterValueType } from "@extynt/project-graph";
import { absentAs, array, boolean, decodeOrCode, fallback, jsonValue, literal, map, nullable, number, object, optional, string, union } from "@extynt/decode";
import type { Decoder, JsonObject } from "@extynt/decode";
import { integerFrom, ordinalList } from "./native-field-decoders.js";

const VALUE_CODE = "INVALID_COLLECTION_VALUE";
const DESCRIPTOR_CODE = "INVALID_COLLECTION_DESCRIPTOR";
const TEXT_LIMIT = 4096;
const PROPERTY_TYPES = literal("unknown", "PROPERTY", "INDEXED_GROUP", "NAMED_GROUP");
const flag: Decoder<number | null> = absentAs(nullable(map(boolean(), Number)), null);
const numericPayload: Decoder<{ shape: "scalar" | "vector"; components: number[] }> = union(
  map(number(), (component) => ({ shape: "scalar" as const, components: [component] })),
  map(array(number(), { minLength: 1, maxLength: 16 }), (components) => ({ shape: "vector" as const, components: [...components] })),
);
const valueFacts = object({
  valueState: fallback(literal("unknown", "observed-static", "observed-key-value"), undefined),
  value: fallback(numericPayload, undefined),
  keyIndex: fallback(integerFrom(1), undefined),
  time: fallback(number(), undefined),
});
const keyframeFields = object({ keyIndex: optional(jsonValue), time: optional(jsonValue) });

interface CollectionValue {
  state: "unknown" | "observed-static" | "observed-key-value";
  shape: "unknown" | "scalar" | "vector";
  components: number[];
  keyIndex: number | null;
  time: number | null;
}

function requireNoKeyframe(row: JsonObject): void {
  const stray = decodeOrCode(keyframeFields, row, VALUE_CODE);
  if (stray.keyIndex !== undefined || stray.time !== undefined) throw Error(VALUE_CODE);
}

/** Reads one value row; a row whose state, payload or keyframe fields disagree throws INVALID_COLLECTION_VALUE. */
export function collectionValue(row: JsonObject): CollectionValue {
  const facts = decodeOrCode(valueFacts, row, VALUE_CODE);
  if (facts.valueState === "unknown") return { state: "unknown", shape: "unknown", components: [], keyIndex: null, time: null };
  if (facts.valueState === undefined || facts.value === undefined) throw Error(VALUE_CODE);
  if (facts.valueState === "observed-static") {
    requireNoKeyframe(row);
    return { state: facts.valueState, ...facts.value, keyIndex: null, time: null };
  }
  if (facts.keyIndex === undefined || facts.time === undefined) throw Error(VALUE_CODE);
  return { state: facts.valueState, ...facts.value, keyIndex: facts.keyIndex, time: facts.time };
}

const nativeStateShape = {
  unitsText: absentAs(nullable(string({ maxLength: TEXT_LIMIT })), null), keyframeCount: absentAs(nullable(integerFrom(0)), null), isTimeVarying: flag,
  expressionEnabled: flag, expressionPresent: flag, canSetValue: flag,
};
const nativeDescriptorShape = {
  ...nativeStateShape, valueType: absentAs(literal(...NATIVE_PARAMETER_VALUE_TYPES), "unknown" as const),
  minimum: absentAs(nullable(number()), null), maximum: absentAs(nullable(number()), null),
};

interface CollectionNativeState {
  units: string | null; keyframeCount: number | null; isTimeVarying: number | null;
  expressionEnabled: number | null; expressionPresent: number | null; canSetValue: number | null;
}

/** A property's native descriptor: its value type and range on top of the live state. */
export interface CollectionNativeDescriptor extends CollectionNativeState { valueType: NativeParameterValueType; minimum: number | null; maximum: number | null }

const nativeDescriptor: Decoder<CollectionNativeDescriptor> = map(object(nativeDescriptorShape), (facts) => ({
  units: facts.unitsText, keyframeCount: facts.keyframeCount, isTimeVarying: facts.isTimeVarying,
  expressionEnabled: facts.expressionEnabled, expressionPresent: facts.expressionPresent, canSetValue: facts.canSetValue,
  valueType: facts.valueType, minimum: facts.minimum, maximum: facts.maximum,
}));

/** Reads a native descriptor; a malformed field or a minimum above the maximum throws INVALID_COLLECTION_DESCRIPTOR. */
export function collectionNativeDescriptor(row: JsonObject): CollectionNativeDescriptor {
  const descriptor = decodeOrCode(nativeDescriptor, row, DESCRIPTOR_CODE);
  if (descriptor.minimum !== null && descriptor.maximum !== null && descriptor.minimum > descriptor.maximum) throw Error(DESCRIPTOR_CODE);
  return descriptor;
}

const identityShape = {
  id: fallback(string(), undefined), path: string({ maxLength: TEXT_LIMIT }), propertyIndices: ordinalList({ minLength: 1, maxLength: 16 }),
  matchName: string({ maxLength: TEXT_LIMIT }), children: integerFrom(0), propertyType: absentAs(PROPERTY_TYPES, "unknown" as const),
  canVaryOverTime: flag, canSetExpression: flag,
};
const identity = object(identityShape);

interface CollectionDescriptor extends CollectionNativeDescriptor {
  path: string; indices: number[]; matchName: string; children: number;
  propertyType: "unknown" | "PROPERTY" | "INDEXED_GROUP" | "NAMED_GROUP"; canVary: number | null; canExpression: number | null;
}

/** Reads one property descriptor row; a row whose path is not its id or whose fields are malformed throws INVALID_COLLECTION_DESCRIPTOR. */
export function collectionDescriptor(row: JsonObject): CollectionDescriptor {
  const facts = decodeOrCode(identity, row, DESCRIPTOR_CODE);
  if (facts.path !== facts.id) throw Error(DESCRIPTOR_CODE);
  return {
    path: facts.path, indices: facts.propertyIndices, matchName: facts.matchName, children: facts.children, propertyType: facts.propertyType,
    canVary: facts.canVaryOverTime, canExpression: facts.canSetExpression, ...collectionNativeDescriptor(row),
  };
}

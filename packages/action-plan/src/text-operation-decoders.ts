// The decoders and types of the text operations: the text document, text animators and their selectors.
import { TEXT_DOCUMENT_FIELDS } from "@extynt/project-graph";
import { array, boolean, jsonObject, jsonValue, literal, number, object, optional, record, refine, string, strictObject, union, type Infer, type JsonValue } from "@extynt/decode";
import { TEXT_ANIMATOR_PROPERTIES, TEXT_SELECTORS, type TextAnimatorPropertyKey, type TextSelectorType } from "./extended.js";
import { both, keyframeLists, keyframeModeDecoder } from "./operation-parts.js";
import { TEXT_JUSTIFICATIONS } from "./plan-constants.js";
import { v2Target } from "./plan-decoders.js";

const DOCUMENT_HEADER_KEYS: readonly string[] = ["type", "target", "characterRanges"];

function isTextDocumentKey(name: string): boolean {
  return Object.hasOwn(TEXT_DOCUMENT_FIELDS, name) || DOCUMENT_HEADER_KEYS.includes(name);
}

function holdsTextDocumentKeys(fields: Readonly<Record<string, JsonValue>>): fields is Readonly<Partial<Record<keyof typeof TEXT_DOCUMENT_FIELDS, JsonValue>>> {
  return Object.keys(fields).every(isTextDocumentKey);
}

function holdsAnimatorProperties(properties: Readonly<Record<string, JsonValue>>): properties is Readonly<Partial<Record<TextAnimatorPropertyKey, JsonValue>>> {
  return Object.keys(properties).every((name) => Object.hasOwn(TEXT_ANIMATOR_PROPERTIES, name));
}

function isTextSelectorType(name: string): name is TextSelectorType {
  return Object.hasOwn(TEXT_SELECTORS, name);
}

const textCharacterRange = both(object({ start: number(), end: number() }), jsonObject);
const textDocumentFields = refine(record(string(), jsonValue), holdsTextDocumentKeys, "only typed text document fields");
const animatorProperties = refine(record(string(), jsonValue), holdsAnimatorProperties, "only text animator properties");
const textSelector = strictObject({
  type: optional(refine(string(), isTextSelectorType, "a text selector type")), settings: optional(record(string(), union(number(), boolean()))), amountExpression: optional(string()),
});

export const setTextDocumentOperation = both(
  object({ type: literal("set_text_document"), target: v2Target, characterRanges: optional(array(textCharacterRange)), justification: optional(literal(...TEXT_JUSTIFICATIONS)) }),
  textDocumentFields,
);
export const ensureTextAnimatorOperation = strictObject({ type: literal("ensure_text_animator"), target: v2Target, role: literal("text.opacity"), value: number() });
export const addTextAnimatorOperation = strictObject({
  type: literal("add_text_animator"), target: v2Target, newAnimatorId: string(), name: optional(string()), properties: optional(animatorProperties), selector: optional(textSelector),
  keyframes: optional(keyframeLists), keyframeMode: optional(keyframeModeDecoder),
});
export const updateTextAnimatorOperation = strictObject({
  type: literal("update_text_animator"), target: v2Target, animatorId: string(), properties: optional(animatorProperties), selector: optional(textSelector),
  keyframes: optional(keyframeLists), keyframeMode: optional(keyframeModeDecoder),
});

export type TextCharacterRange = Infer<typeof textCharacterRange>;
export type TextSelectorSpec = Infer<typeof textSelector>;
export type TextAnimatorRole = "text.opacity";
export type SetTextDocumentOperation = Infer<typeof setTextDocumentOperation>;
export type EnsureTextAnimatorOperation = Infer<typeof ensureTextAnimatorOperation>;
export type AddTextAnimatorOperation = Infer<typeof addTextAnimatorOperation>;
export type UpdateTextAnimatorOperation = Infer<typeof updateTextAnimatorOperation>;

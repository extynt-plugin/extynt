/**
 * The typed TextDocument surface, limited to the fields AE 26.2.1 evidence showed are both readable and writable;
 * apps/panel/host/probe.jsx mirrors the field table as AE_TEXT_FIELDS, kept identical by a contract test.
 */
import { isJsonArray, type JsonObject, type JsonValue } from "@extynt/decode";

/** The part of a text document a field belongs to. */
export type TextFieldScope = "content" | "character" | "paragraph" | "box";
/** One writable text field: a number carries `hostScale` when AE stores the value as percent times that multiplier or fraction, and `rangeOnly` when AE ignores a document-level write. */
export type TextFieldSpec =
  | { kind: "string"; scope: TextFieldScope; maxLength: number }
  | { kind: "number"; scope: TextFieldScope; min: number; max: number; hostScale?: number; rangeOnly?: boolean }
  | { kind: "boolean"; scope: TextFieldScope }
  | { kind: "color"; scope: TextFieldScope }
  | { kind: "vec2"; scope: TextFieldScope; min: number; max: number }
  | { kind: "enum"; scope: TextFieldScope; enumObject: string; values: readonly string[] };

/**
 * Every writable text field. allCaps, smallCaps, superscript, subscript, composerEngine, boxOverflow, boxText and pointText are read-only and absent; the writable forms are fontCapsOption and fontBaselineOption. Kerning is the space after one character, and a whole-document write reads back 0 on AE 26.2.1. Scales are percent in the API, like the Character panel, while AE 26 stores a multiplier (1 = 100%, max 100) and a 0-1 tsume fraction.
 */
export const TEXT_DOCUMENT_FIELDS = {
  text: { kind: "string", scope: "content", maxLength: 4096 },
  font: { kind: "string", scope: "character", maxLength: 256 },
  fontSize: { kind: "number", scope: "character", min: 1, max: 1000 },
  applyFill: { kind: "boolean", scope: "character" },
  fillColor: { kind: "color", scope: "character" },
  applyStroke: { kind: "boolean", scope: "character" },
  strokeColor: { kind: "color", scope: "character" },
  strokeWidth: { kind: "number", scope: "character", min: 0, max: 1000 },
  strokeOverFill: { kind: "boolean", scope: "character" },
  lineJoinType: { kind: "enum", scope: "character", enumObject: "LineJoinType", values: ["LINE_JOIN_MITER", "LINE_JOIN_ROUND", "LINE_JOIN_BEVEL"] },
  tracking: { kind: "number", scope: "character", min: -1000, max: 10000 },
  kerning: { kind: "number", scope: "character", min: -1000, max: 10000, rangeOnly: true },
  autoKernType: { kind: "enum", scope: "character", enumObject: "AutoKernType", values: ["NO_AUTO_KERN", "METRIC_KERN", "OPTICAL_KERN"] },
  leading: { kind: "number", scope: "character", min: 0, max: 5000 },
  autoLeading: { kind: "boolean", scope: "character" },
  leadingType: { kind: "enum", scope: "character", enumObject: "LeadingType", values: ["ROMAN_LEADING_TYPE", "JAPANESE_LEADING_TYPE"] },
  baselineShift: { kind: "number", scope: "character", min: -5000, max: 5000 },
  horizontalScale: { kind: "number", scope: "character", min: 1, max: 10000, hostScale: 0.01 },
  verticalScale: { kind: "number", scope: "character", min: 1, max: 10000, hostScale: 0.01 },
  tsume: { kind: "number", scope: "character", min: 0, max: 100, hostScale: 0.01 },
  fauxBold: { kind: "boolean", scope: "character" },
  fauxItalic: { kind: "boolean", scope: "character" },
  fontCapsOption: { kind: "enum", scope: "character", enumObject: "FontCapsOption", values: ["FONT_NORMAL_CAPS", "FONT_SMALL_CAPS", "FONT_ALL_CAPS", "FONT_ALL_SMALL_CAPS"] },
  fontBaselineOption: { kind: "enum", scope: "character", enumObject: "FontBaselineOption", values: ["FONT_NORMAL_BASELINE", "FONT_FAUXED_SUPERSCRIPT", "FONT_FAUXED_SUBSCRIPT"] },
  ligature: { kind: "boolean", scope: "character" },
  noBreak: { kind: "boolean", scope: "character" },
  digitSet: { kind: "enum", scope: "character", enumObject: "DigitSet", values: ["DEFAULT_DIGITS", "ARABIC_DIGITS", "ARABIC_DIGITS_RTL", "FARSI_DIGITS", "HINDI_DIGITS"] },
  baselineDirection: { kind: "enum", scope: "character", enumObject: "BaselineDirection", values: ["BASELINE_WITH_STREAM", "BASELINE_VERTICAL_ROTATED", "BASELINE_VERTICAL_CROSS_STREAM"] },
  justification: { kind: "enum", scope: "paragraph", enumObject: "ParagraphJustification", values: ["LEFT_JUSTIFY", "CENTER_JUSTIFY", "RIGHT_JUSTIFY", "FULL_JUSTIFY_LASTLINE_LEFT", "FULL_JUSTIFY_LASTLINE_RIGHT", "FULL_JUSTIFY_LASTLINE_CENTER", "FULL_JUSTIFY_LASTLINE_FULL"] },
  direction: { kind: "enum", scope: "paragraph", enumObject: "ParagraphDirection", values: ["DIRECTION_LEFT_TO_RIGHT", "DIRECTION_RIGHT_TO_LEFT"] },
  lineOrientation: { kind: "enum", scope: "paragraph", enumObject: "LineOrientation", values: ["HORIZONTAL", "VERTICAL_LEFT_TO_RIGHT", "VERTICAL_RIGHT_TO_LEFT"] },
  firstLineIndent: { kind: "number", scope: "paragraph", min: -10000, max: 10000 },
  startIndent: { kind: "number", scope: "paragraph", min: -10000, max: 10000 },
  endIndent: { kind: "number", scope: "paragraph", min: -10000, max: 10000 },
  spaceBefore: { kind: "number", scope: "paragraph", min: -10000, max: 10000 },
  spaceAfter: { kind: "number", scope: "paragraph", min: -10000, max: 10000 },
  autoHyphenate: { kind: "boolean", scope: "paragraph" },
  everyLineComposer: { kind: "boolean", scope: "paragraph" },
  hangingRoman: { kind: "boolean", scope: "paragraph" },
  boxTextSize: { kind: "vec2", scope: "box", min: 1, max: 30000 },
  boxTextPos: { kind: "vec2", scope: "box", min: -30000, max: 30000 },
  boxAutoFitPolicy: { kind: "enum", scope: "box", enumObject: "BoxAutoFitPolicy", values: ["NONE", "HEIGHT_CURSOR", "HEIGHT_PRECISE_BOUNDS", "HEIGHT_BASELINE"] },
  boxFirstBaselineAlignment: { kind: "enum", scope: "box", enumObject: "BoxFirstBaselineAlignment", values: ["ASCENT", "CAP_HEIGHT", "EM_BOX", "LEADING", "LEGACY_METRIC", "MINIMUM_VALUE_ASIAN", "MINIMUM_VALUE_ROMAN", "TYPO_ASCENT", "X_HEIGHT"] },
  boxFirstBaselineAlignmentMinimum: { kind: "number", scope: "box", min: 0, max: 10000 },
  boxInsetSpacing: { kind: "number", scope: "box", min: 0, max: 10000 },
  boxVerticalAlignment: { kind: "enum", scope: "box", enumObject: "BoxVerticalAlignment", values: ["TOP", "CENTER", "BOTTOM", "JUSTIFY"] },
} as const satisfies Record<string, TextFieldSpec>;

/** The name of a writable text field. */
export type TextDocumentField = keyof typeof TEXT_DOCUMENT_FIELDS;
/** The most character ranges one text edit may style. */
export const TEXT_RANGE_MAX = 64;

const TEXT_FIELD_SPECS: Record<string, TextFieldSpec> = TEXT_DOCUMENT_FIELDS;
const ALL_TEXT_SCOPES: readonly TextFieldScope[] = ["content", "character", "paragraph", "box"];

type StringFieldSpec = Extract<TextFieldSpec, { kind: "string" }>;
type NumberFieldSpec = Extract<TextFieldSpec, { kind: "number" }>;
type Vec2FieldSpec = Extract<TextFieldSpec, { kind: "vec2" }>;
type EnumFieldSpec = Extract<TextFieldSpec, { kind: "enum" }>;

function isFiniteNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isUnitChannel(value: JsonValue | undefined): boolean {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function stringFieldError(field: string, value: JsonValue | undefined, spec: StringFieldSpec): string | null {
  const ok = typeof value === "string" && value.length <= spec.maxLength && (field === "text" || value.trim().length > 0);
  return ok ? null : `${field} must be a string of at most ${spec.maxLength} characters.`;
}

function numberFieldError(field: string, value: JsonValue | undefined, spec: NumberFieldSpec): string | null {
  return isFiniteNumber(value) && value >= spec.min && value <= spec.max ? null : `${field} must be from ${spec.min} to ${spec.max}.`;
}

function booleanFieldError(field: string, value: JsonValue | undefined): string | null {
  return typeof value === "boolean" ? null : `${field} must be boolean.`;
}

function colorFieldError(field: string, value: JsonValue | undefined): string | null {
  const channels = isJsonArray(value) ? value : [];
  return channels.length === 3 && channels.every(isUnitChannel) ? null : `${field} must be three 0-1 channels.`;
}

function vec2FieldError(field: string, value: JsonValue | undefined, spec: Vec2FieldSpec): string | null {
  const items = isJsonArray(value) ? value : [];
  return items.length === 2 && items.every((item) => isFiniteNumber(item) && item >= spec.min && item <= spec.max) ? null : `${field} must be two numbers from ${spec.min} to ${spec.max}.`;
}

function enumFieldError(field: string, value: JsonValue | undefined, spec: EnumFieldSpec): string | null {
  return typeof value === "string" && spec.values.includes(value) ? null : `${field} must be one of ${spec.values.join(", ")}.`;
}

function fieldValueError(spec: TextFieldSpec, field: string, value: JsonValue | undefined): string | null {
  switch (spec.kind) {
    case "string": return stringFieldError(field, value, spec);
    case "number": return numberFieldError(field, value, spec);
    case "boolean": return booleanFieldError(field, value);
    case "color": return colorFieldError(field, value);
    case "vec2": return vec2FieldError(field, value, spec);
    case "enum": return enumFieldError(field, value, spec);
  }
}

/**
 * Why a value cannot be written to a text field, or null when it can. The field must belong to one of `allowedScopes`
 * (every scope by default); a range-only field such as kerning is accepted only with `inRange`, inside characterRanges.
 */
export function textFieldError(field: string, value: JsonValue | undefined, allowedScopes: readonly TextFieldScope[] = ALL_TEXT_SCOPES, inRange = false): string | null {
  const spec = TEXT_FIELD_SPECS[field];
  if (!spec || !allowedScopes.includes(spec.scope)) return `${field} is not a typed text field here.`;
  if (spec.kind === "number" && spec.rangeOnly && !inRange) return `${field} only applies inside characterRanges (the space after each character); use tracking for the whole layer.`;
  return fieldValueError(spec, field, value);
}

function schemaOfField(spec: TextFieldSpec): JsonObject {
  switch (spec.kind) {
    case "string": return { type: "string", maxLength: spec.maxLength };
    case "number": return { type: "number", minimum: spec.min, maximum: spec.max };
    case "boolean": return { type: "boolean" };
    case "color": return { type: "array", description: "RGB, three 0-1 numbers." };
    case "vec2": return { type: "array", description: `[x, y], ${spec.min} to ${spec.max}.` };
    case "enum": return { type: "string", enum: [...spec.values] };
  }
}

/** The JSON schema of every text field in `scopes`, keyed by field name. */
export function textFieldSchemas(scopes: readonly TextFieldScope[]): JsonObject {
  return Object.fromEntries(Object.entries(TEXT_FIELD_SPECS).filter(([, spec]) => scopes.includes(spec.scope)).map(([field, spec]) => [field, schemaOfField(spec)]));
}

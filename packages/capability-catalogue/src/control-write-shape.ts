// Describes what to write for an effect control: the lever, stated before the write is attempted.
import { isFiniteNumber, isJsonArray } from "@extynt/decode";
import type { JsonValue } from "@extynt/decode";

import type { ControlSchema, HostCapabilityProfile } from "./catalogue-model.js";
import { menuChoices, menuDefaultText } from "./menu-labels.js";
import { controlIsUserAssisted } from "./user-assisted.js";

/** Which family of value a control takes; the description and the validator both see it. */
export type ControlWriteKind =
  | "number" | "toggle" | "menu" | "color" | "vector" | "boolean"
  | "index" | "structured" | "user-assisted" | "read-only" | "group" | "unknown";

/**
 * The structured write shape for one control. `line` is the one-line instruction with the schema's own bounds and
 * default. `enforced` is true when `effectControlValueError` refuses a differently shaped value. `userAssisted` is true
 * when the control has no value a script can write (custom UI, a button, an Options panel). `example` is a specimen
 * of the described shape, never a value this module writes into a plan.
 */
export interface ControlWriteShape {
  matchName: string;
  displayName: string;
  kind: ControlWriteKind;
  line: string;
  enforced: boolean;
  role?: string;
  min?: number;
  max?: number;
  dimensions?: number;
  defaultValue?: JsonValue;
  menu?: readonly string[];
  animatable: boolean;
  readOnly: boolean;
  userAssisted: boolean;
  example?: JsonValue;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(6)));
}

const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight"];
function countWord(count: number): string { return COUNT_WORDS[count] ?? String(count); }

function defaultValueSuffix(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  return `, default ${JSON.stringify(value)}`;
}

const STRUCTURED_TYPES: Readonly<Record<string, string>> = {
  shape: "a shape path, not a plain value",
  "text-document": "a text document, not a plain value",
  marker: "a marker, not a plain value",
  custom: "a custom value, not a plain value",
  none: "no readable value: After Effects reports NO_VALUE",
};

const KIND_RULES: ReadonlyArray<readonly [ControlWriteKind, (control: ControlSchema) => boolean]> = [
  ["group", (control) => control.valueType === "group"],
  ["user-assisted", controlIsUserAssisted],
  ["read-only", (control) => control.canSetValue === false],
  ["menu", (control) => (control.menu?.length ?? 0) > 0 || control.valueType === "enum"],
  ["color", (control) => control.valueType === "color"],
  ["vector", (control) => control.valueType === "vector"],
  ["boolean", (control) => control.valueType === "boolean"],
  ["index", (control) => control.valueType === "layer" || control.valueType === "mask"],
  ["structured", (control) => control.valueType in STRUCTURED_TYPES],
  ["number", (control) => control.valueType === "number"],
];

function kindOf(control: ControlSchema): ControlWriteKind {
  const rule = KIND_RULES.find(([, matches]) => matches(control));
  if (!rule) return "unknown";
  return rule[0] === "number" && control.min === 0 && control.max === 1 ? "toggle" : rule[0];
}

function inRange(control: ControlSchema, value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value)
    && (control.min === undefined || value >= control.min) && (control.max === undefined || value <= control.max);
}

function fallbackNumber(control: ControlSchema): number {
  if (typeof control.min === "number" && Number.isFinite(control.min)) return control.min;
  if (typeof control.max === "number" && Number.isFinite(control.max)) return control.max;
  return 0.5;
}

function numberExample(control: ControlSchema): number {
  return inRange(control, control.defaultValue) ? control.defaultValue : fallbackNumber(control);
}

function menuExample(control: ControlSchema): number {
  const count = control.menu?.length ?? 0;
  const value = control.defaultValue;
  return count && typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= count ? value : 1;
}

function booleanExample(control: ControlSchema): boolean {
  return typeof control.defaultValue === "boolean" ? control.defaultValue : true;
}

function unitChannel(value: JsonValue): boolean { return typeof value === "number" && value >= 0 && value <= 1; }

function colorExample(control: ControlSchema): JsonValue {
  const value = control.defaultValue;
  if (isJsonArray(value) && value.length >= 3 && value.length <= 4 && value.every(unitChannel)) return value;
  return [0.5, 0.5, 0.5];
}

function vectorExample(control: ControlSchema): JsonValue {
  const dimensions = control.dimensions && control.dimensions >= 2 ? control.dimensions : 2;
  const value = control.defaultValue;
  if (isJsonArray(value) && value.length === dimensions && value.every(isFiniteNumber)) return value;
  return Array.from({ length: dimensions }, () => 0.5);
}

function indexExample(control: ControlSchema): number {
  return inRange(control, control.defaultValue) ? control.defaultValue : 1;
}

function exampleFor(control: ControlSchema, kind: ControlWriteKind): JsonValue | undefined {
  if (kind === "number" || kind === "toggle") return numberExample(control);
  if (kind === "menu") return menuExample(control);
  if (kind === "boolean") return booleanExample(control);
  if (kind === "color") return colorExample(control);
  if (kind === "vector") return vectorExample(control);
  if (kind === "index") return indexExample(control);
  return undefined;
}

function boundsOf(control: ControlSchema): string | undefined {
  if (typeof control.min === "number" && typeof control.max === "number") return `${formatNumber(control.min)} to ${formatNumber(control.max)}`;
  if (typeof control.min === "number") return `${formatNumber(control.min)} or more`;
  if (typeof control.max === "number") return `up to ${formatNumber(control.max)}`;
  return undefined;
}

function menuLine(control: ControlSchema): string {
  if (control.menu?.length) return `menu: ${menuChoices(control.menu, control.defaultValue)}${menuDefaultText(control.menu, control.defaultValue)}`;
  if (typeof control.max === "number") return `one menu item number, 1 to ${formatNumber(control.max)}${defaultValueSuffix(control.defaultValue)}`;
  return `a menu item number (this schema does not list the items)${defaultValueSuffix(control.defaultValue)}`;
}

function vectorLine(control: ControlSchema): string {
  if (control.dimensions) return `${countWord(control.dimensions)} numbers${defaultValueSuffix(control.defaultValue)}`;
  return `an array of numbers (this schema does not state how many)${defaultValueSuffix(control.defaultValue)}`;
}

function indexLine(control: ControlSchema): string {
  return `a ${control.valueType === "mask" ? "mask" : "layer"} index number${defaultValueSuffix(control.defaultValue)}`;
}

function numericLine(control: ControlSchema, bounds: string | undefined): string {
  return `one number${bounds ? `, ${bounds}` : ""}${defaultValueSuffix(control.defaultValue)}`;
}

const LINE_BUILDERS: Readonly<Partial<Record<ControlWriteKind, (control: ControlSchema) => string>>> = {
  group: () => "a property group, not a value",
  "user-assisted": () => "user assisted: After Effects has no value a script can write here (custom control, button or options panel). Do not plan a write to it; tell the user to set it by hand in After Effects",
  "read-only": () => "read-only: After Effects reports it cannot be set",
  menu: menuLine,
  color: (control) => `3-4 channels, each 0 to 1${defaultValueSuffix(control.defaultValue)}`,
  vector: vectorLine,
  toggle: (control) => `one number 0 or 1, or true/false${defaultValueSuffix(control.defaultValue)}`,
  boolean: (control) => `true or false${defaultValueSuffix(control.defaultValue)}`,
  index: indexLine,
  structured: (control) => STRUCTURED_TYPES[control.valueType] ?? `not a plain value (${control.valueType})`,
  unknown: (control) => `the schema does not state a writable value shape (${control.valueType})`,
};

function writeLine(control: ControlSchema, kind: ControlWriteKind, bounds: string | undefined): string {
  return LINE_BUILDERS[kind]?.(control) ?? numericLine(control, bounds);
}

function shapeLine(control: ControlSchema, kind: ControlWriteKind, animatable: boolean): string {
  const keyframeNote = kind === "group" || kind === "read-only" || kind === "user-assisted" || animatable ? "" : "; cannot be keyframed";
  return `${writeLine(control, kind, boundsOf(control))}${keyframeNote}`;
}

function shapeFacts(control: ControlSchema, example: JsonValue | undefined): Partial<ControlWriteShape> {
  return {
    ...(control.role ? { role: control.role } : {}),
    ...(control.min !== undefined ? { min: control.min } : {}),
    ...(control.max !== undefined ? { max: control.max } : {}),
    ...(control.dimensions !== undefined ? { dimensions: control.dimensions } : {}),
    ...(control.defaultValue !== undefined ? { defaultValue: control.defaultValue } : {}),
    ...(control.menu ? { menu: control.menu } : {}),
    ...(example !== undefined ? { example } : {}),
  };
}

/** The write shape of one control: `line` is the model-readable instruction, every other field is the schema fact behind it. */
export function controlWriteShape(control: ControlSchema): ControlWriteShape {
  const kind = kindOf(control);
  const example = exampleFor(control, kind);
  const animatable = control.animatable !== false;
  return {
    matchName: control.matchName,
    displayName: control.displayName,
    kind,
    line: shapeLine(control, kind, animatable),
    enforced: enforcedKind(control, kind),
    ...shapeFacts(control, example),
    animatable,
    readOnly: control.canSetValue === false,
    userAssisted: kind === "user-assisted",
  };
}

function enforcedKind(control: ControlSchema, kind: ControlWriteKind): boolean {
  if (kind === "number" || kind === "toggle" || kind === "menu") return true;
  if (kind === "color") return true;
  if (kind === "vector") return control.dimensions !== undefined;
  return false;
}

/** The one line for a control, as it would be shown to an agent. */
export function describeControlWrite(control: ControlSchema): string {
  const shape = controlWriteShape(control);
  return `${shape.displayName || shape.matchName} — ${shape.line}`;
}

/** The write lines for a control list, skipping property groups and bounded so a large effect cannot flood a turn. */
export function describeControlWrites(controls: readonly ControlSchema[], limit = 40): string[] {
  return controls.filter((control) => control.valueType !== "group").slice(0, Math.max(0, limit)).map(describeControlWrite);
}

/** The write lines for an effect of the host profile, found by id or match name; undefined when the profile has no such effect. */
export function describeEffectWrites(profile: HostCapabilityProfile | undefined, entryId: string, limit = 40): { id: string; displayName: string; description: string; controls: string[] } | undefined {
  const entry = profile?.entries.find((candidate) => candidate.id === entryId || candidate.matchName === entryId);
  if (!entry || entry.kind !== "effect") return undefined;
  return { id: entry.id, displayName: entry.displayName, description: entry.description, controls: describeControlWrites(entry.controls ?? [], limit) };
}

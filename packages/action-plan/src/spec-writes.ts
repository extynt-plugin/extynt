// Resolves the `values` and `keyframes` of a text-animator or shape-item operation against its spec table into exact relative
// matchName writes, refusing a value that does not fit its spec.
import { accepts, array, isJsonArray } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { TEXT_ANIMATOR_PROPERTIES, TEXT_SELECTORS, type TextSelectorType, type ValueSpec } from "./extended.js";
import { isJsonObject } from "./json-shape.js";
import type { SpecWrites } from "./operation-checks.js";
import { toJsonValue } from "./plain-json.js";
import { keyframeSpec, type KeyframeSpec } from "./keyframe-decoder.js";
import { isFiniteInRange } from "./validation-primitives.js";

type SpecTable = Readonly<Record<string, ValueSpec>>;

type SpecWrite = SpecWrites["writes"][number];
type SpecAnimation = SpecWrites["animations"][number];
type SpecRequest = { readonly specs: SpecTable; readonly values: JsonObject | undefined; readonly label: string };

const SELECTOR_PATH_PREFIX = "ADBE Text Selectors";

function valueSpecError(spec: ValueSpec, value: JsonValue | undefined): string | undefined {
  if (spec.kind === "boolean") return typeof value === "boolean" ? undefined : "must be boolean";
  if (spec.kind === "menu") return isMenuValue(value, spec.max ?? 1) ? undefined : `must be a menu item number 1-${spec.max}`;
  if (spec.kind === "number" || spec.kind === "color") return scalarSpecError(spec, value);
  return vectorSpecError(spec, value);
}

function scalarSpecError(spec: ValueSpec, value: JsonValue | undefined): string | undefined {
  if (spec.kind === "number") return isSpecNumber(spec, value) ? undefined : `must be a number from ${spec.min} to ${spec.max}`;
  return isColorValue(value) ? undefined : "must be an RGB array of three 0-1 numbers";
}

function vectorSpecError(spec: ValueSpec, value: JsonValue | undefined): string | undefined {
  if (isSpecVector(spec, value)) return undefined;
  return `must be an array of ${specVectorDims(spec).join(" or ")} numbers from ${spec.min} to ${spec.max}`;
}

function isMenuValue(value: JsonValue | undefined, max: number): boolean { return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max; }
function isColorValue(value: JsonValue | undefined): boolean { return isJsonArray(value) && value.length === 3 && value.every((channel) => isFiniteInRange(channel, 0, 1)); }
function isSpecNumber(spec: ValueSpec, value: JsonValue | undefined): boolean { return isFiniteInRange(value, spec.min ?? -1e7, spec.max ?? 1e7); }
function specVectorDims(spec: ValueSpec): number[] { return spec.kind === "vec2" ? [2] : [2, 3]; }
function isSpecVector(spec: ValueSpec, value: JsonValue | undefined): boolean { return isJsonArray(value) && specVectorDims(spec).includes(value.length) && value.every((entry) => isSpecNumber(spec, entry)); }
function isStaticSpecKind(spec: ValueSpec): boolean { return spec.kind === "boolean" || spec.kind === "menu"; }
function specOf(specs: SpecTable, key: string): ValueSpec | undefined { return Object.hasOwn(specs, key) ? specs[key] : undefined; }

const isKeyframeSpecs = accepts(array(keyframeSpec));

function valueWrites(request: SpecRequest, writes: SpecWrite[]): string | undefined {
  const { specs, values, label } = request;
  for (const [key, value] of Object.entries(values ?? {})) {
    const spec = specOf(specs, key);
    if (!spec) return `${label} has no setting "${key}"; use one of ${Object.keys(specs).join(", ")}.`;
    const error = valueSpecError(spec, value);
    if (error) return `${label}.${key} ${error}.`;
    writes.push({ key, path: spec.path, value });
  }
  return undefined;
}

function frameValueError(spec: ValueSpec, frames: readonly JsonValue[], where: string): string | undefined {
  for (const frame of frames) {
    const error = valueSpecError(spec, isJsonObject(frame) ? frame.value : undefined);
    if (error) return `${where} keyframe value ${error}.`;
  }
  return undefined;
}

function keyframeListError(spec: ValueSpec, frames: JsonValue, where: string): string | undefined {
  if (!isJsonArray(frames) || frames.length < 1) return `${where} keyframes must be a non-empty array.`;
  return frameValueError(spec, frames, where);
}

function keyframeWrite(request: SpecRequest, key: string, frames: JsonValue, animations: SpecAnimation[]): string | undefined {
  const { specs, values, label } = request;
  const spec = specOf(specs, key);
  if (!spec) return `${label} has no animatable setting "${key}".`;
  if (isStaticSpecKind(spec)) return `${label}.${key} is a ${spec.kind} and is set statically, not keyframed.`;
  const listError = keyframeListError(spec, frames, `${label}.${key}`);
  if (listError) return listError;
  if (Object.hasOwn(values ?? {}, key)) return `${label}.${key} cannot be both set and keyframed in one operation.`;
  if (!isKeyframeSpecs(frames)) return `${label}.${key} keyframes must be a non-empty array.`;
  animations.push({ key, path: spec.path, keyframes: frames });
  return undefined;
}

/** Resolves `values` and `keyframes` keys to exact relative matchName paths, checking every value and keyframe value against its spec; the first problem comes back as a message. */
export function resolveJsonSpecWrites(specs: SpecTable, values: JsonObject | undefined, keyframes: JsonObject | undefined, label: string): SpecWrites | string {
  const request: SpecRequest = { specs, values, label };
  const writes: SpecWrite[] = [];
  const animations: SpecAnimation[] = [];
  const valuesError = valueWrites(request, writes);
  if (valuesError) return valuesError;
  for (const [key, frames] of Object.entries(keyframes ?? {})) {
    const error = keyframeWrite(request, key, frames, animations);
    if (error) return error;
  }
  return { writes, animations };
}

/** The same resolution for an operation whose keyframes are typed keyframe lists; each animation keeps the operation's own list. */
export function resolveSpecWrites(specs: SpecTable, values: JsonObject | undefined, keyframes: Readonly<Record<string, readonly KeyframeSpec[]>> | undefined, label: string): SpecWrites | string {
  const json = toJsonValue(keyframes);
  const resolved = resolveJsonSpecWrites(specs, values, isJsonObject(json) ? json : undefined, label);
  if (typeof resolved === "string") return resolved;
  return { writes: resolved.writes, animations: resolved.animations.map((animation) => ({ ...animation, keyframes: keyframes?.[animation.key] ?? animation.keyframes })) };
}

/** The settings a text animator accepts: its animator properties plus the chosen selector's settings under `selector.<name>`. */
export function textAnimatorSpecs(selector: TextSelectorType): Record<string, ValueSpec> {
  const specs: Record<string, ValueSpec> = { ...TEXT_ANIMATOR_PROPERTIES };
  const selectorSpec = TEXT_SELECTORS[selector];
  for (const [key, spec] of Object.entries(selectorSpec.settings)) specs[`selector.${key}`] = { ...spec, path: `${SELECTOR_PATH_PREFIX}/${selectorSpec.matchName}/${spec.path}` };
  return specs;
}

/** The number of keyframes the resolved animations write. */
export function writtenKeyframeCount(resolved: SpecWrites): number { return resolved.animations.reduce((sum, animation) => sum + animation.keyframes.length, 0); }

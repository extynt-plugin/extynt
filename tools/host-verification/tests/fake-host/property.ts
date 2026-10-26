/**
 * The fake After Effects property/value model: a matchName tree carrying the value
 * shapes the host reads back.
 *
 * After Effects hands back a snapshot from a property getter, so `value` copies a
 * gradient rather than exposing it; vector properties read back with the host's own
 * component count (`dimensions`/`padValue`), effect-control colours are Float32, and
 * `valueAtTime(t, true)` is the keyed value where `valueAtTime(t, false)` is the
 * evaluated one. The fake mirrors those behaviours; its numbers are not evidence
 * about After Effects.
 */
import { FakeGradient, isHostArray, type HostValue } from "./gradient.js";
import type { Json } from "./narrow.js";
import { sampleKeys, upsertKeyframe, type Keyframe } from "./keyframes.js";

export { FakeGradient } from "./gradient.js";

/** Distinct from FakeProperty so the probe's `instanceof PropertyGroup` stays meaningful. */
export class FakePropertyGroup {}

interface PropertySpec {
  matchName: string;
  name?: string;
  value?: HostValue;
  create?: () => HostValue;
  dimensions?: number;
  padValue?: Json;
  propertyType?: number;
  valueType?: number;
  float32?: boolean;
}

const MATERIALISED_CHILDREN: Record<string, PropertySpec[]> = {
  "ADBE Mask Atom": [
    { matchName: "ADBE Mask Shape" },
    { matchName: "ADBE Mask Feather" },
    { matchName: "ADBE Mask Opacity", value: 100 },
    { matchName: "ADBE Mask Offset" },
  ],
  "ADBE Vector Group": [
    { matchName: "ADBE Vector Blend Mode", name: "Blend Mode" },
    { matchName: "ADBE Vectors Group", name: "Contents", propertyType: 3 },
    { matchName: "ADBE Vector Transform Group", name: "Transform" },
    { matchName: "ADBE Vector Materials Group", name: "Material Options" },
  ],
  "ADBE Vector Shape - Ellipse": [
    { matchName: "ADBE Vector Ellipse Size", value: [100, 100], dimensions: 2, valueType: 2 },
    { matchName: "ADBE Vector Ellipse Position", value: [0, 0], dimensions: 2, valueType: 2 },
    { matchName: "ADBE Vector Shape Direction", value: 1 },
  ],
  "ADBE Vector Graphic - Fill": [
    { matchName: "ADBE Vector Fill Color", value: [0, 0, 0, 1], dimensions: 4, padValue: 1 },
    { matchName: "ADBE Vector Fill Opacity", value: 100 },
  ],
  "ADBE Ramp": [
    { matchName: "ADBE Ramp-0001", name: "Start of Ramp", value: [0, 0], dimensions: 2, valueType: 2 },
    { matchName: "ADBE Ramp-0002", name: "Start Color", value: [0, 0, 0, 1], dimensions: 4, padValue: 1, valueType: 4, float32: true },
    { matchName: "ADBE Ramp-0003", name: "End of Ramp", value: [320, 180], dimensions: 2, valueType: 2 },
    { matchName: "ADBE Ramp-0004", name: "End Color", value: [1, 1, 1, 1], dimensions: 4, padValue: 1, valueType: 4, float32: true },
    { matchName: "ADBE Ramp-0005", name: "Ramp Shape", value: 1 },
    { matchName: "ADBE Ramp-0006", name: "Ramp Scatter", value: 0 },
    { matchName: "ADBE Ramp-0007", name: "Blend With Original", value: 0 },
  ],
};

const gradientChildren = (matchName: string): PropertySpec[] => [
  { matchName: "ADBE Vector Grad Type", value: 2 },
  { matchName: "ADBE Vector Grad Start Pt", value: [0, 0], valueType: 3 },
  { matchName: "ADBE Vector Grad End Pt", value: [0, 0], valueType: 3 },
  { matchName: "ADBE Vector Grad HiLite Length", value: 0 },
  { matchName: "ADBE Vector Grad HiLite Angle", value: 0 },
  { matchName: "ADBE Vector Grad Colors", create: () => new FakeGradient(), valueType: 7 },
  matchName === "ADBE Vector Graphic - G-Stroke"
    ? { matchName: "ADBE Vector Stroke Width", value: 2 }
    : { matchName: "ADBE Vector Fill Opacity", value: 100 },
];

const materialisedChild = (spec: PropertySpec): FakeProperty => {
  const property = new FakeProperty(spec.matchName, spec.name);
  if (spec.create) property.baseValue = spec.create();
  else if ("value" in spec) property.baseValue = spec.value;
  if (spec.dimensions !== undefined) property.dimensions = spec.dimensions;
  if (spec.padValue !== undefined) property.padValue = spec.padValue;
  if (spec.propertyType !== undefined) property.propertyType = spec.propertyType;
  if (spec.valueType !== undefined) property.propertyValueType = spec.valueType;
  if (spec.float32 !== undefined) property.float32 = spec.float32;
  return property;
};

function materialiseChildren(child: FakeProperty): void {
  const specs = child.matchName === "ADBE Vector Graphic - G-Fill" || child.matchName === "ADBE Vector Graphic - G-Stroke"
    ? gradientChildren(child.matchName)
    : MATERIALISED_CHILDREN[child.matchName];
  for (const spec of specs ?? []) {
    const materialised = materialisedChild(spec);
    materialised.parent = child;
    child.children.push(materialised);
  }
}

export class FakeProperty {
  matchName: string;
  name: string;
  parent: FakeProperty | null = null;
  children: FakeProperty[] = [];
  baseValue: HostValue = null;
  canSetValue = true;
  expression = "";
  expressionEnabled = false;
  expressionError = "";
  canVaryOverTime = true;
  propertyValueType = 1;
  propertyType = 1;
  dimensions = 0;
  padValue: Json = 0;
  float32 = false;
  keys: Keyframe[] = [];
  timeOf: () => number = () => 0;

  constructor(matchName: string, name?: string) {
    this.matchName = matchName;
    this.name = name ?? matchName;
  }
  get numProperties(): number { return this.children.length; }
  get numKeys(): number { return this.keys.length; }
  get isTimeVarying(): boolean { return this.keys.length > 0; }
  normalise(value: HostValue): HostValue {
    if (!isHostArray(value)) return value;
    const dimensions = this.dimensions > 0 ? this.dimensions : value.length;
    const padding = Array<Json>(Math.max(0, dimensions - value.length)).fill(this.padValue);
    return [...value, ...padding].slice(0, dimensions).map((entry) => (this.float32 && typeof entry === "number" ? Math.fround(entry) : entry));
  }
  get value(): HostValue {
    const resolved = this.valueAtTime(this.timeOf(), false);
    return resolved instanceof FakeGradient ? resolved.copy() : resolved;
  }
  set value(next: HostValue) { this.baseValue = this.normalise(next); }
  property(indexOrName: number | string): FakeProperty | null {
    if (typeof indexOrName === "number") return this.children[indexOrName - 1] ?? null;
    return walk(this, indexOrName);
  }
  addProperty(matchName: string): FakeProperty {
    const child = new FakeProperty(matchName);
    child.parent = this;
    materialiseChildren(child);
    this.children.push(child);
    return child;
  }
  remove(): void { if (this.parent) { const index = this.parent.children.indexOf(this); if (index >= 0) this.parent.children.splice(index, 1); } }
  setValue(next: HostValue): void { this.baseValue = this.normalise(next); }
  setValuesAtTimes(times: number[], values: HostValue[]): void { this.keys = times.map((t, index) => ({ t, v: this.normalise(values[index] ?? null) })); }
  keyTime(index: number): number | null { return this.keys[index - 1]?.t ?? null; }
  keyValue(index: number): HostValue { const entry = this.keys[index - 1]; return entry ? this.normalise(entry.v) : null; }
  keyedValue(time: number): HostValue { return sampleKeys(this.keys, this.baseValue, time); }
  writeKey(time: number, value: HostValue): void { upsertKeyframe(this.keys, time, this.normalise(value)); }
  evaluate(keyed: HostValue): HostValue {
    if (this.expression === "value / 2") return typeof keyed === "number" ? keyed / 2 : keyed;
    if (this.expression === "[960, 1400]") return [960, 1400];
    return keyed;
  }
  valueAtTime(time: number, preExpression?: boolean): HostValue {
    const keyed = this.keyedValue(time);
    if (preExpression === true) return this.normalise(keyed);
    if (this.expressionEnabled && this.expression) return this.normalise(this.evaluate(keyed));
    return this.normalise(keyed);
  }
}

interface PathStep { name: string; ordinal: number }

const pathStepOf = (part: string): PathStep => {
  const hash = part.lastIndexOf("#");
  return hash > 0 ? { name: part.slice(0, hash), ordinal: Number(part.slice(hash + 1)) } : { name: part, ordinal: 1 };
};

const childAt = (parent: FakeProperty, step: PathStep): FakeProperty | null =>
  parent.children.filter((child) => child.matchName === step.name)[step.ordinal - 1] ?? null;

export function walk(root: FakeProperty, path: string): FakeProperty | null {
  let current: FakeProperty | null = root;
  for (const part of path.split("/")) {
    if (!current) return null;
    current = childAt(current, pathStepOf(part));
  }
  return current;
}

export function attachTime(property: FakeProperty, timeOf: () => number): void {
  property.timeOf = timeOf;
  if (property.matchName === "ADBE Mask Opacity" || property.matchName === "ADBE Transform Group") property.propertyValueType = 1;
  for (const child of property.children) attachTime(child, timeOf);
}

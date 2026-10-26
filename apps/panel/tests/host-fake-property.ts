/**
 * The fake After Effects property: a tree node with children, keyframes, expressions and the value reads the
 * apply_plan suites exercise. host-fake-groups.ts builds the special groups on top of it.
 */

import type { JsonObject, JsonValue } from "@extynt/decode";

/** A path-like value a host property holds: vertices, tangents and a closed fallback(literal(true), false). */
export class FakeShape {
  public vertices: readonly (readonly number[])[] | null = null;
  public inTangents: readonly (readonly number[])[] | null = null;
  public outTangents: readonly (readonly number[])[] | null = null;
  public closed = false;
}

/** A text document value: the host reads `text` and may call document methods a test adds, so classes and richer objects fit. */
export interface FakeTextDocument {
  text: string;
}

/** Everything a fake property can hold or return: any JSON value, a shape for path properties, or a text document with methods. */
export type FakeValue = JsonValue | FakeShape | FakeTextDocument;

/** What a property is added to as an Essential Graphics controller: the composition that receives it. */
export interface FakeTemplateTarget {
  readonly id: string;
}

/** A keyframe ease as the host passes it: speed and influence. */
export type FakeEase = { readonly speed: number; readonly influence: number };

/** Interpolation recorded at one key. */
export type FakeInterpolation = { readonly inType: string; readonly outType: string };

/** Temporal ease recorded at one key. */
export type FakeTemporalEase = { readonly inEase: readonly FakeEase[]; readonly outEase: readonly FakeEase[] };

/** Spatial tangents recorded at one key. */
export type FakeSpatialTangents = { readonly inTangent: readonly number[]; readonly outTangent: readonly number[] };

/** One keyframe of a fake property. */
export interface FakeKeyframe {
  time: number;
  value: FakeValue;
}

/** One expression evaluation the fake serves at a time, or the error it raises. */
export interface FakeExpressionValue {
  time: number;
  value: FakeValue;
  error?: string;
}

/** The optional constructor tail: children, value, then whether the value can be set (default: a leaf can). */
export type FakePropertyTail = readonly [children?: FakeProperty[], value?: FakeValue, canSetValue?: boolean];

const SAME_TIME_TOLERANCE = 1e-9;

function sameTime(first: number, second: number): boolean {
  return Math.abs(first - second) < SAME_TIME_TOLERANCE;
}

function isJsonObject(candidate: FakeValue): candidate is JsonObject {
  return typeof candidate === "object" && candidate !== null && !Array.isArray(candidate) && !(candidate instanceof FakeShape);
}

/** A node of the fake property tree; keys stay time-ordered and a write at an existing time replaces that key, as After Effects does. */
export class FakeProperty {
  public enabled = true;
  public isHidden = false;
  public dimensionsSeparated = false;
  public expression = "";
  public expressionEnabled = false;
  public expressionError = "";
  public expressionValues: FakeExpressionValue[] | null = null;
  public valueAtTimeThrows = false;
  public canVaryOverTime: boolean | undefined = undefined;
  public leafNumPropertiesThrows = false;
  public numKeys = 0;
  public keyframes: FakeKeyframe[] = [];
  public interpolation: Array<FakeInterpolation | undefined> = [];
  public temporalEase: Array<FakeTemporalEase | undefined> = [];
  public isSpatial = false;
  public spatialTangents: FakeSpatialTangents[] = [];
  public roving: boolean[] = [];
  public setValueAtTimeCalls = 0;
  public addToMotionGraphicsTemplateAs?: (target: FakeTemplateTarget, name: string) => boolean;
  public children: FakeProperty[];
  public value: FakeValue;
  public canSetValue: boolean;

  public constructor(public matchName: string, public name: string, ...[children = [], value = null, canSetValue = children.length === 0]: FakePropertyTail) {
    this.children = children;
    this.value = value;
    this.canSetValue = canSetValue;
  }

  public get numProperties(): number {
    if (this.leafNumPropertiesThrows) throw new Error("numProperties is unavailable on this AE Property");
    return this.children.length;
  }

  public property(index: number | string): FakeProperty | null {
    if (typeof index === "number") return this.children[index - 1] ?? null;
    return this.children.find((child) => child.matchName === index || child.name === index) ?? null;
  }

  public canAddProperty(_matchName: string): boolean {
    return false;
  }

  public addProperty(_matchName: string): FakeProperty | null {
    return null;
  }

  public setValue(value: FakeValue): void {
    this.value = value;
  }

  public setValueAtTime(time: number, value: FakeValue): void {
    this.setValueAtTimeCalls += 1;
    const existing = this.keyframes.findIndex((key) => sameTime(key.time, time));
    if (existing >= 0) this.keyframes[existing] = { time, value };
    else this.insertKey(time, value);
    this.numKeys = this.keyframes.length;
    this.value = value;
  }

  private insertKey(time: number, value: FakeValue): void {
    const later = this.keyframes.findIndex((key) => key.time > time);
    const index = later < 0 ? this.keyframes.length : later;
    this.keyframes.splice(index, 0, { time, value });
    this.interpolation.splice(index, 0, undefined);
    this.temporalEase.splice(index, 0, undefined);
  }

  public nearestKeyIndex(time: number): number {
    let best = 0;
    let distance = Number.POSITIVE_INFINITY;
    this.keyframes.forEach((key, index) => {
      const gap = Math.abs(key.time - time);
      if (gap >= distance) return;
      distance = gap;
      best = index + 1;
    });
    return best;
  }

  public keyInTemporalEase(index: number): readonly FakeEase[] | null {
    return this.temporalEase[index - 1]?.inEase ?? null;
  }

  public keyOutTemporalEase(index: number): readonly FakeEase[] | null {
    return this.temporalEase[index - 1]?.outEase ?? null;
  }

  public keyInSpatialTangent(_index: number): number[] {
    return [0, 0];
  }

  public keyOutSpatialTangent(_index: number): number[] {
    return [0, 0];
  }

  public setSpatialTangentsAtKey(index: number, inTangent: readonly number[], outTangent: readonly number[]): void {
    if (!this.isSpatial) throw new Error("not spatial");
    this.spatialTangents[index - 1] = { inTangent, outTangent };
  }

  public setRovingAtKey(index: number, roving: boolean): void {
    if (index === 1 || index === this.numKeys) throw new Error("first and last keys cannot rove");
    this.roving[index - 1] = roving;
  }

  public keyTime(index: number): number {
    return this.keyframes[index - 1]?.time ?? -1;
  }

  public keyValue(index: number): FakeValue | undefined {
    return this.keyframes[index - 1]?.value;
  }

  public valueAtTime(time: number, _skipExpression?: boolean): FakeValue {
    if (this.valueAtTimeThrows) throw new Error("After Effects could not evaluate the expression");
    const evaluated = this.expressionValues?.find((entry) => sameTime(entry.time, time));
    this.expressionError = evaluated?.error ?? "";
    if (evaluated) return evaluated.value;
    const key = this.keyframes.find((entry) => sameTime(entry.time, time));
    return key ? key.value : this.value;
  }

  public removeKey(index: number): void {
    this.keyframes.splice(index - 1, 1);
    this.interpolation.splice(index - 1, 1);
    this.temporalEase.splice(index - 1, 1);
    this.numKeys = this.keyframes.length;
  }

  public setInterpolationTypeAtKey(index: number, inType: string, outType: string): void {
    this.interpolation[index - 1] = { inType, outType };
  }

  public setTemporalEaseAtKey(index: number, inEase: readonly FakeEase[], outEase: readonly FakeEase[]): void {
    this.temporalEase[index - 1] = { inEase, outEase };
  }
}

/** After Effects hands out a fresh TextDocument on every Source Text read, so one key cannot alias another; the fake aliases unless a test asks for this. */
export function withFreshTextDocuments(property: FakeProperty): FakeProperty {
  let document: JsonObject = isJsonObject(property.value) ? { ...property.value } : {};
  Object.defineProperty(property, "value", {
    get: (): JsonObject => ({ ...document }),
    set: (next: FakeValue): void => {
      if (isJsonObject(next)) document = { ...next };
    },
    configurable: true,
  });
  return property;
}

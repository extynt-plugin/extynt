/**
 * Keyframe writes: a plan's keys are parsed and bounded, then written, merged or replaced under the mode the plan names.
 * A write the fixture cannot make faithfully is refused by code instead of approximated.
 */

import { isWireArray, isWireObject } from "@extynt/fake-plugin";
import type { KeyframeSnapshot, PropertySnapshot } from "@extynt/project-graph";
import { keyframeCount } from "./fake-host-model.js";
import { UNSUPPORTED_IN_FIXTURE } from "./fake-host-tables.js";
import { isFiniteNumber, refuse, toJson, type Field, type JsonObject } from "./fake-host-values.js";
import type { WireObject } from "./wire-types.js";

const MAX_KEYFRAMES_PER_ANIMATION = 1024;

const KEYFRAME_MODE: ReadonlySet<string> = new Set(["reject", "merge", "replace"]);

const KEYFRAME_SHAPING_FIELDS = ["curve", "ease", "spatial", "temporal", "roving", "interpolation"] as const;

interface FrameSite { position: number; total: number; label: string }

interface CubicCurve { x1: number; y1: number; x2: number; y2: number }

function cubicCurveOf(curve: WireObject): CubicCurve | undefined {
  const { x1, y1, x2, y2 } = curve;
  if (!isFiniteNumber(x1) || !isFiniteNumber(y1) || !isFiniteNumber(x2) || !isFiniteNumber(y2)) return undefined;
  return { x1, y1, x2, y2 };
}

function curvePointsInRange(curve: CubicCurve): boolean {
  return curve.x1 >= 0 && curve.x1 <= 1 && curve.x2 >= 0 && curve.x2 <= 1 && Math.abs(curve.y1) <= 10 && Math.abs(curve.y2) <= 10;
}

function validateFrameCurve(curve: Field, site: FrameSite): void {
  const { position, total, label } = site;
  if (position === total - 1) refuse("INVALID_VALUE", `${label}: a curve shapes the segment to the next keyframe, so the last keyframe cannot carry one.`);
  if (typeof curve === "string") return;
  const points = isWireObject(curve) ? cubicCurveOf(curve) : undefined;
  if (!points) refuse("INVALID_VALUE", `${label}: keyframe ${position} curve must be a cubic-bezier object or a preset name.`);
  if (!curvePointsInRange(points)) refuse("INVALID_VALUE", `${label}: keyframe ${position} curve control points are outside the accepted range (x 0-1, y -10 to 10).`);
}

function frameShaping(raw: WireObject, site: FrameSite): JsonObject {
  const shaping: JsonObject = {};
  for (const field of KEYFRAME_SHAPING_FIELDS) {
    const value = raw[field];
    if (value === undefined) continue;
    const json = toJson(value);
    if (json === undefined) refuse("INVALID_VALUE", `${site.label}: keyframe ${site.position} ${field} must be a JSON value.`);
    shaping[field] = json;
  }
  return shaping;
}

function parseFrame(raw: Field, site: FrameSite, previous: number): KeyframeSnapshot {
  const { position, label } = site;
  if (!isWireObject(raw)) refuse("INVALID_VALUE", `${label}: keyframe ${position} must be an object.`);
  const time = raw.time;
  if (!isFiniteNumber(time) || time < 0) refuse("INVALID_VALUE", `${label}: keyframe ${position} needs a finite time of 0 or more.`);
  if (time <= previous) refuse("INVALID_VALUE", `${label}: keyframe times must strictly increase; ${time} does not follow ${previous}.`);
  const value = toJson(raw.value);
  if (value === undefined) refuse("INVALID_VALUE", `${label}: keyframe ${position} needs a JSON value.`);
  if (raw.curve !== undefined) validateFrameCurve(raw.curve, site);
  return { time, value, ...frameShaping(raw, site) };
}

/** The plan's keys, each checked and the whole list bounded and strictly increasing in time. */
export function parseFrames(rawFrames: Field, label: string): KeyframeSnapshot[] {
  if (!isWireArray(rawFrames) || rawFrames.length < 1 || rawFrames.length > MAX_KEYFRAMES_PER_ANIMATION) {
    refuse("INVALID_VALUE", `${label}: keyframes must be an array of 1-${MAX_KEYFRAMES_PER_ANIMATION} entries.`);
  }
  const frames: KeyframeSnapshot[] = [];
  let previous = -1;
  for (const [position, raw] of rawFrames.entries()) {
    const frame = parseFrame(raw, { position, total: rawFrames.length, label }, previous);
    previous = frame.time;
    frames.push(frame);
  }
  return frames;
}

function keyframeModeOf(rawMode: Field, label: string): string {
  if (rawMode === undefined) return "reject";
  if (typeof rawMode !== "string" || !KEYFRAME_MODE.has(rawMode)) refuse("INVALID_VALUE", `${label}: keyframeMode must be reject, merge, or replace.`);
  return rawMode;
}

function mergeKeyframes(property: PropertySnapshot, frames: KeyframeSnapshot[], label: string): KeyframeSnapshot[] {
  const existing = property.keyframes ?? [];
  if (existing.length === 0) {
    refuse(UNSUPPORTED_IN_FIXTURE, `${label}: this fixture records only the keyframe count (${keyframeCount(property)}) of ${property.path}, not the keys themselves, so "merge" cannot be applied faithfully. Use keyframeMode "replace".`);
  }
  const byTime = new Map<number, KeyframeSnapshot>();
  for (const key of existing) byTime.set(key.time, { ...key });
  for (const frame of frames) byTime.set(frame.time, { ...frame });
  return [...byTime.values()].sort((left, right) => left.time - right.time);
}

function keyDigestOf(keyframes: readonly KeyframeSnapshot[]): string {
  const text = JSON.stringify(keyframes);
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 33 + text.charCodeAt(index)) % 4294967296;
  return `${keyframes.length}:${keyframes.length}:${hash.toString(16)}`;
}

/** Writes the plan's keys onto the property under its mode, refusing a conflict or a malformed key by code. */
export function writeKeyframes(property: PropertySnapshot, rawFrames: Field, rawMode: Field, label: string): void {
  const mode = keyframeModeOf(rawMode, label);
  const frames = parseFrames(rawFrames, label);
  const existingCount = keyframeCount(property);
  if (existingCount > 0 && mode === "reject") {
    refuse("CONFLICTING_KEYS", `${label}: ${property.path} already has ${existingCount} keyframe(s); set keyframeMode to "merge" or "replace" to change them.`);
  }
  const merged = mode === "replace" || existingCount === 0 ? frames.map((frame) => ({ ...frame })) : mergeKeyframes(property, frames, label);
  property.keyframes = merged;
  property.keyframeCount = merged.length;
  property.keyDigest = keyDigestOf(merged);
  property.value = null;
}

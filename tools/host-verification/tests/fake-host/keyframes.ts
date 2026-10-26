/**
 * The fixture's keyframe store: one flat, time-sorted key list per property.
 *
 * After Effects stores a keyed value in the property's own shape (a Position key
 * written as [100,100] reads back [100,100,0]), so every writer normalises before
 * storing; sampling interpolates between keys and extends the first/last key
 * outside the key range.
 */
import { isHostArray, type HostValue } from "./gradient.js";
import type { Json } from "./narrow.js";

export interface Keyframe { t: number; v: HostValue }

const lerp = (left: Json, right: Json | undefined, ratio: number): Json => (typeof left === "number" && typeof right === "number" ? left + (right - left) * ratio : left);

const interpolate = (before: HostValue, after: HostValue, ratio: number): HostValue => {
  if (typeof before === "number" && typeof after === "number") return before + (after - before) * ratio;
  if (isHostArray(before) && isHostArray(after)) return before.map((entry, index) => lerp(entry, after[index], ratio));
  return before;
};

const segmentAt = (keys: Keyframe[], time: number): { before: Keyframe; after: Keyframe; ratio: number } | null => {
  for (let index = 1; index < keys.length; index += 1) {
    const before = keys[index - 1], after = keys[index];
    if (before && after && time <= after.t) {
      const span = after.t - before.t;
      return { before, after, ratio: span === 0 ? 0 : (time - before.t) / span };
    }
  }
  return null;
};

export const sampleKeys = (keys: Keyframe[], baseValue: HostValue, time: number): HostValue => {
  const first = keys[0], last = keys[keys.length - 1];
  if (!first || !last) return baseValue;
  if (time <= first.t) return first.v;
  if (time >= last.t) return last.v;
  const segment = segmentAt(keys, time);
  return segment ? interpolate(segment.before.v, segment.after.v, segment.ratio) : last.v;
};

/** Writes a key at `time`, replacing an existing key at that exact time, and keeps the list sorted. */
export const upsertKeyframe = (keys: Keyframe[], time: number, value: HostValue): void => {
  const existing = keys.findIndex((key) => key.t === time);
  if (existing >= 0) keys[existing] = { t: time, v: value };
  else keys.push({ t: time, v: value });
  keys.sort((left, right) => left.t - right.t);
};

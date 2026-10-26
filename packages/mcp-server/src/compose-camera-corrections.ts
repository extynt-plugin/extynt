// dolly_camera keyframes: times that arrive out of order name one right answer, so they are sorted rather than refused.
import { recordChange } from "./compose-correction-core.js";
import type { CorrectionStep } from "./compose-correction-core.js";
import { arrayAt, asObject, numberAt } from "./json.js";
import type { JsonArray, JsonValue } from "@extynt/decode";

interface TimedKeyframe {
  readonly keyframe: JsonValue;
  readonly time: number;
}

function timedKeyframes(keyframes: JsonArray): TimedKeyframe[] | undefined {
  const timed = keyframes.flatMap((keyframe) => {
    const time = numberAt(asObject(keyframe), "time");
    return time !== undefined && Number.isFinite(time) ? [{ keyframe, time }] : [];
  });
  const distinct = new Set(timed.map((entry) => entry.time)).size === timed.length;
  return timed.length === keyframes.length && distinct ? timed : undefined;
}

/** Sorts a dolly_camera's keyframes by time when every time is a distinct number; a duplicate time or a missing one is left for the validator to name. */
export const sortDollyKeyframes: CorrectionStep = (operation, context) => {
  const keyframes = context.type === "dolly_camera" ? arrayAt(operation, "keyframes") : undefined;
  const timed = keyframes && keyframes.length >= 2 ? timedKeyframes(keyframes) : undefined;
  if (!keyframes || !timed) return undefined;
  const sorted = [...timed].sort((left, right) => left.time - right.time);
  if (sorted.every((entry, at) => entry === timed[at])) return undefined;
  const sortedKeyframes = sorted.map((entry) => entry.keyframe);
  recordChange(context, { field: "keyframes", from: keyframes, to: sortedKeyframes, why: "keyframe times must increase; each distance stays with its time" });
  operation.keyframes = sortedKeyframes;
  return undefined;
};

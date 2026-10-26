// Checks and bookkeeping shared by the operation kinds that write keyframes or settings from a spec table.
import type { JsonObject, JsonValue } from "@extynt/decode";
import { isJsonObject } from "./json-shape.js";
import { keyframeSequenceError } from "./keyframe-rules.js";
import { operationTargetsLayer, type LayerAddress, type OperationContext } from "./layer-targets.js";
import type { KeyframeSpec } from "./plan-types.js";
import { invalid, objectsIn, type Refusal } from "./validation-primitives.js";

const MAX_KEYFRAME_SETTINGS = 32;
const SELECTOR_KEY_PREFIX = "selector.";

/** The values and keyframe lists a spec table resolved for one operation: one entry per property it writes. */
export type SpecWrites = { readonly writes: readonly { key: string; path: string; value: JsonValue }[]; readonly animations: readonly { key: string; path: string; keyframes: readonly KeyframeSpec[] }[] };

/** True when an earlier operation in the plan satisfies the predicate. */
export function earlierWith(operations: readonly JsonValue[], predicate: (operation: JsonObject) => boolean): boolean { return objectsIn(operations).some(predicate); }

/** True when the operation addresses the same composition and layer as the target. */
export function sameLayer(operation: JsonObject, target: LayerAddress): boolean { return operationTargetsLayer(operation, target); }

export function writesNothing(resolved: SpecWrites): boolean { return !resolved.writes.length && !resolved.animations.length; }

/** True when the spec writes at least one animator property rather than only text-selector settings. */
export function declaresAnimatorProperty(resolved: SpecWrites): boolean { return resolved.writes.some((write) => !write.key.startsWith(SELECTOR_KEY_PREFIX)) || resolved.animations.some((animation) => !animation.key.startsWith(SELECTOR_KEY_PREFIX)); }

/** The refusal for a keyframe map that is not up to 32 setting keys of well-formed keyframe lists, or a keyframeMode without keyframes. */
export function keyframeChecks({ operation }: OperationContext): Refusal | undefined {
  const keyframes = operation.keyframes;
  const mode = operation.keyframeMode;
  if (keyframes === undefined) return mode === undefined ? undefined : invalid("INVALID_VALUE", "keyframeMode requires keyframes.");
  if (!isJsonObject(keyframes) || Object.keys(keyframes).length > MAX_KEYFRAME_SETTINGS) return invalid("INVALID_VALUE", "keyframes must map up to 32 setting keys to keyframe arrays.");
  for (const frames of Object.values(keyframes)) {
    const error = keyframeSequenceError({ keyframes: frames, ...(mode === undefined ? {} : { keyframeMode: mode }) });
    if (error) return error;
  }
  return undefined;
}

// The verdict for read_keyframes: it changes nothing, so the verdict is the rows the host returned, carried to the agent in the outcome.
import { array, boolean, decode, fallback, jsonValue, number, object, optional, string } from "@extynt/decode";
import { exactStep, unverifiedStep } from "./verdicts.js";
import type { VerifiedStep } from "./verdicts.js";
import { layerWhere } from "./verify-context.js";
import type { LayerState } from "./verify-context.js";

const keysEvidence = object({ keys: optional(fallback(array(jsonValue), undefined)), propertyPath: optional(fallback(string(), undefined)), totalKeys: optional(fallback(number(), undefined)), truncated: optional(fallback(boolean(), undefined)), expressionEnabled: optional(fallback(boolean(), undefined)) });

/** The verdict for read_keyframes. */
export function verifyReadKeyframes(state: LayerState): VerifiedStep {
  const kind = state.request.operation;
  const where = layerWhere(state);
  const decoded = decode(keysEvidence, state.step.row);
  const read = decoded.ok ? decoded.value : {};
  if (!read.keys) return unverifiedStep(kind, "keyframes-not-reported", where);
  return exactStep(kind, "keyframes-read", { ...where, propertyPath: read.propertyPath ?? null, totalKeys: read.totalKeys ?? read.keys.length, truncated: read.truncated === true, expressionEnabled: read.expressionEnabled === true, keys: [...read.keys] });
}

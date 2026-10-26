/** The native plugin's response envelope: one decoder for the line every request is answered with. */
import { boolean, fallback, jsonValue, map, number, object, optional, string, union } from "@extynt/decode";
import type { Infer } from "@extynt/decode";

const optionalNumber = optional(fallback(number(), undefined));
const optionalText = optional(fallback(string(), undefined));

const TIMING = object({
  totalMainThreadMs: optionalNumber,
  queuedMs: optionalNumber,
  walkMs: optionalNumber,
  hashMs: optionalNumber,
  serializeMs: optionalNumber,
  bytes: optionalNumber,
  getterCalls: optionalNumber,
  dispatchedBy: optionalText,
});

/** The per-request timings the plugin reports; every figure may be absent. */
export type NativeTiming = Infer<typeof TIMING>;

/**
 * Accepts one response line's JSON: `ok` reads false unless it is true; `id` is a string or number and is read as a string;
 * a bad `result`, `error` or `timing` reads as absent.
 */
export const NATIVE_RESPONSE = object({
  ok: fallback(boolean(), false),
  id: optional(map(union(string(), number()), (id) => String(id))),
  result: optional(fallback(jsonValue, undefined)),
  error: optional(fallback(object({ code: optionalText, message: optionalText }), undefined)),
  timing: optional(fallback(TIMING, undefined)),
});

/** A decoded response of the native plugin. */
export type NativeResponse = Infer<typeof NATIVE_RESPONSE>;

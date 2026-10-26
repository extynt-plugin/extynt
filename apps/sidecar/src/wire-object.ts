// The decoder for an object the sidecar receives as a plain value: what it would be on the wire, with undefined fields dropped and non-finite numbers made null.
import { isJsonObject, refine, wireJson } from "@extynt/decode";

/** Accepts a plain object and yields its JSON form; anything that is not an object, or carries a value JSON cannot hold, is rejected. */
export const wireObject = refine(wireJson, isJsonObject, "an object");

// Reads the machine code a failure carries in its `cause`, as Node's fetch and socket errors do.
import type { Decoder } from "./decoder.js";
import { map } from "./composites.js";
import { object } from "./object.js";
import { string } from "./primitives.js";

/** Accepts an error (or any object) whose `cause` has a string `code`, such as `ECONNRESET`, and yields that code; an error without one is rejected. */
export const errorCauseCode: Decoder<string> = map(object({ cause: object({ code: string() }) }), (error) => error.cause.code);

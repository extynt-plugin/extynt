// Shared helpers for the decode tests: unwrap a result into its value or its error, failing the test otherwise.
import assert from "node:assert/strict";
import { decode } from "../src/index.js";
import type { DecodeError, Decoder } from "../src/index.js";

/** The decoded value, failing the test with the error message when decoding is rejected. */
export function valueOf<T, I>(decoder: Decoder<T>, input: I): T {
  const result = decode(decoder, input);
  if (!result.ok) assert.fail(result.error.message);
  return result.value;
}

/** The error of a rejected input, failing the test when decoding is accepted. */
export function errorOf<T, I>(decoder: Decoder<T>, input: I): DecodeError {
  const result = decode(decoder, input);
  if (result.ok) assert.fail(`accepted ${JSON.stringify(result.value)}`);
  return result.error;
}

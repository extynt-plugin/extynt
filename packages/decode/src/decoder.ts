// The decoder contract, its inference helper and the public entry points that turn a decoder's outcome into a result, an exception or JSON text decoding.
import { Failure, describeRelativePath, kindOf } from "./failure.js";

/** A decoder turns untrusted input into a `T`, or returns the `Failure` that explains why it cannot. */
export interface Decoder<T> {
  readonly run: (input: unknown) => T | Failure;
}

/** The type of any decoder, for combinators that accept decoders of unrelated output types. */
export type AnyDecoder = Decoder<unknown>;

/** The static type a decoder produces. */
export type Infer<D> = D extends Decoder<infer T> ? T : never;

/** Why decoding failed: a JSON path such as `$.layers[3].name`, what was expected there and what was found. */
export interface DecodeError {
  readonly path: string;
  readonly expected: string;
  readonly found: string;
  readonly message: string;
}

/** The outcome of decoding: the value, or the error that names the field. */
export type DecodeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DecodeError };

/** The exception form of a `DecodeError`, for call sites that prefer to throw. */
export class DecodeFailure extends Error {
  readonly error: DecodeError;

  constructor(error: DecodeError) {
    super(error.message);
    this.name = "DecodeFailure";
    this.error = error;
  }
}

const NOT_JSON_EXPECTED = "valid JSON text";

function toError(failure: Failure): DecodeError {
  const path = `$${describeRelativePath(failure.path)}`;
  return { path, expected: failure.expected, found: failure.found, message: `${path}: expected ${failure.expected}, found ${failure.found}` };
}

/** Decodes the input and returns a discriminated result; the error path is rendered only here, on failure. */
export function decode<T>(decoder: Decoder<T>, input: unknown): DecodeResult<T> {
  const outcome = decoder.run(input);
  return outcome instanceof Failure ? { ok: false, error: toError(outcome) } : { ok: true, value: outcome };
}

/** Decodes the input and returns the value, or throws a `DecodeFailure` carrying the error. */
export function decodeOrThrow<T>(decoder: Decoder<T>, input: unknown): T {
  const result = decode(decoder, input);
  if (!result.ok) throw new DecodeFailure(result.error);
  return result.value;
}

/** Parses JSON text and decodes it; text that is not JSON becomes a `DecodeError` at `$`. */
export function decodeJson<T>(text: string, decoder: Decoder<T>): DecodeResult<T> {
  try {
    const parsed: unknown = JSON.parse(text);
    return decode(decoder, parsed);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { ok: false, error: toError(new Failure(NOT_JSON_EXPECTED, error.message || kindOf(text))) };
  }
}

/** True for the error `decodeJson` reports when the text is not JSON at all, as opposed to JSON of the wrong shape. */
export function isNotJson(error: DecodeError): boolean {
  return error.path === "$" && error.expected === NOT_JSON_EXPECTED;
}

/** Decodes the input and returns the value, or throws a plain `Error` whose message is the given code, for callers that map failures to a code and need no field path. */
export function decodeOrCode<T>(decoder: Decoder<T>, input: unknown, code: string): T {
  const result = decode(decoder, input);
  if (!result.ok) throw Error(code);
  return result.value;
}

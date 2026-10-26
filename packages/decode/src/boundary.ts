// Helpers for code that meets values it cannot describe up front: guards built from decoders, instances and rejection reasons.
import type { Decoder } from "./decoder.js";
import { Failure, fail } from "./failure.js";

/** Turns a decoder into a type guard, so code outside this package can narrow a value without naming the unknown type. */
export function accepts<T>(decoder: Decoder<T>): (input: unknown) => input is T {
  return (input): input is T => !(decoder.run(input) instanceof Failure);
}

/** Accepts an instance of the class. */
export function instanceOf<T>(type: abstract new (...args: never[]) => T, expected: string): Decoder<T> {
  return { run: (input) => (input instanceof type ? input : fail(expected, input)) };
}

/** The message of an Error, or the text of anything else a promise rejected or a caller threw with. */
export function failureText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** A `.catch`/`.then` rejection handler that gets the failure as text, so the call site never types the rejection reason. */
export function onFailureText<R>(handle: (message: string) => R): (reason: unknown) => R {
  return (reason) => handle(failureText(reason));
}

/** A rejection handler that rethrows the reason unless it is an Error accepted by `handle`; for `.catch` chains that only absorb one kind of failure. */
export function onError<R>(handle: (error: Error) => R): (reason: unknown) => R {
  return (reason) => {
    if (reason instanceof Error) return handle(reason);
    throw reason;
  };
}

// Decoders for JSON scalars: strings, numbers, booleans and literal unions, each with optional constraints.
import type { Decoder } from "./decoder.js";
import { fail, failShowing } from "./failure.js";
import type { Failure } from "./failure.js";

/** Optional constraints on a string; `nonEmpty` is shorthand for a minimum length of one. */
export interface StringLimits {
  readonly nonEmpty?: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: RegExp;
}

/** Optional constraints on a number, which is always finite. */
export interface NumberLimits {
  readonly int?: boolean;
  readonly min?: number;
  readonly max?: number;
}

/** The scalar values a literal decoder can accept. */
export type Literal = string | number | boolean | null;

function stringLengthProblem(text: string, limits: StringLimits): string | null {
  if (limits.nonEmpty === true && text.length === 0) return "non-empty string";
  if (limits.minLength !== undefined && text.length < limits.minLength) return `string of at least ${limits.minLength} characters`;
  if (limits.maxLength !== undefined && text.length > limits.maxLength) return `string of at most ${limits.maxLength} characters`;
  return null;
}

function stringProblem(text: string, limits: StringLimits): string | null {
  const lengthProblem = stringLengthProblem(text, limits);
  if (lengthProblem !== null) return lengthProblem;
  return limits.pattern !== undefined && !limits.pattern.test(text) ? `string matching ${limits.pattern.source}` : null;
}

/** Accepts a string that satisfies the limits. */
export function string(limits: StringLimits = {}): Decoder<string> {
  return {
    run(input) {
      if (typeof input !== "string") return fail("string", input);
      const problem = stringProblem(input, limits);
      return problem === null ? input : failShowing(problem, input);
    },
  };
}

function numberProblem(value: number, limits: NumberLimits): string | null {
  if (limits.int === true && !Number.isInteger(value)) return "integer";
  if (limits.min !== undefined && value < limits.min) return `number of at least ${limits.min}`;
  if (limits.max !== undefined && value > limits.max) return `number of at most ${limits.max}`;
  return null;
}

/** Accepts a finite number (never NaN or an infinity) that satisfies the limits. */
export function number(limits: NumberLimits = {}): Decoder<number> {
  return {
    run(input) {
      if (typeof input !== "number" || !Number.isFinite(input)) return fail("finite number", input);
      const problem = numberProblem(input, limits);
      return problem === null ? input : failShowing(problem, input);
    },
  };
}

/** Accepts `true` or `false`. */
export function boolean(): Decoder<boolean> {
  return { run: (input) => (typeof input === "boolean" ? input : fail("boolean", input)) };
}

function isLiteralScalar(input: unknown): input is Literal {
  return typeof input === "string" || typeof input === "number" || typeof input === "boolean" || input === null;
}

/** Accepts exactly one of the given scalars; the output type is their literal union. */
export function literal<const V extends readonly Literal[]>(...values: V): Decoder<V[number]> {
  const allowed: ReadonlySet<Literal> = new Set(values);
  const expected = values.map((value) => JSON.stringify(value)).join(" or ");
  const isMember = (input: unknown): input is V[number] => isLiteralScalar(input) && allowed.has(input);
  return { run: (input): V[number] | Failure => (isMember(input) ? input : failShowing(expected, input)) };
}

/** Accepts only `null`. */
export const nullValue: Decoder<null> = literal(null);

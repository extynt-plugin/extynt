// The internal failure value every decoder returns on rejection; the public error and its path string are built from it only when someone asks.

interface PathStep {
  readonly key: string | number;
  readonly next: PathStep | null;
}

/** A rejected input: what was expected, what was found, and where, with no string work done until it is rendered. */
export class Failure {
  readonly expected: string;
  readonly found: string;
  readonly path: PathStep | null;

  constructor(expected: string, found: string, path: PathStep | null = null) {
    this.expected = expected;
    this.found = found;
    this.path = path;
  }
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const SHOWN_LENGTH_MAX = 40;

/** Names the JSON kind of a value: null, array, undefined, or its typeof. */
export function kindOf(input: unknown): string {
  if (input === null) return "null";
  return Array.isArray(input) ? "array" : typeof input;
}

function showScalar(input: string | number | boolean | null): string {
  const text = JSON.stringify(input);
  return text.length > SHOWN_LENGTH_MAX ? `${text.slice(0, SHOWN_LENGTH_MAX)}...` : text;
}

function showInput(input: unknown): string {
  const scalar = typeof input === "string" || typeof input === "number" || typeof input === "boolean" || input === null;
  return scalar ? showScalar(input) : kindOf(input);
}

/** A failure at the current position that reports the kind of the offending value. */
export function fail(expected: string, input: unknown): Failure {
  return new Failure(expected, kindOf(input));
}

/** A failure at the current position that reports the offending scalar by value. */
export function failShowing(expected: string, input: unknown): Failure {
  return new Failure(expected, showInput(input));
}

/** The same failure seen from one level further out, under the given object key or array index. */
export function within(failure: Failure, key: string | number): Failure {
  return new Failure(failure.expected, failure.found, { key, next: failure.path });
}

/** Renders a path relative to its start: `.layers[3].name`, or the empty string for no steps. */
export function describeRelativePath(path: PathStep | null): string {
  let text = "";
  for (let step = path; step !== null; step = step.next) {
    if (typeof step.key === "number") text += `[${step.key}]`;
    else text += IDENTIFIER.test(step.key) ? `.${step.key}` : `[${JSON.stringify(step.key)}]`;
  }
  return text;
}

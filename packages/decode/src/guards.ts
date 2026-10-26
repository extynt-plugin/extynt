// Type guards that narrow untrusted input to an array, a plain keyed object or a finite number before any element is read.

/** True for a JSON array. */
export function isArray(input: unknown): input is ReadonlyArray<unknown> {
  return Array.isArray(input);
}

/** An object whose keys are read one by one before any value is trusted. */
export interface KeyedInput {
  readonly [key: string]: unknown;
}

/** True for a JSON object: not null and not an array. */
export function isRecord(input: unknown): input is KeyedInput {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

/** True for a number that is neither NaN nor an infinity. */
export function isFiniteNumber(input: unknown): input is number {
  return typeof input === "number" && Number.isFinite(input);
}

// The one narrowing helper tests share: a value that must be there, or a failure that says what was missing.

/** The value, or a thrown error naming what a test expected and did not get. */
export function present<T>(value: T | null | undefined, what = "value"): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}

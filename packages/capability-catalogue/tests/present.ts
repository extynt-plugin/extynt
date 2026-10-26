// Test helper: narrows a looked-up value to its defined type, failing the test with a message when it is missing.
import assert from "node:assert/strict";

export function present<T>(value: T | null | undefined, what: string): T {
  assert.ok(value !== undefined && value !== null, `${what} must be present`);
  return value;
}

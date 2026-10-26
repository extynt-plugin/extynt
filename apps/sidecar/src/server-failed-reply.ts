// The reply of a route whose work failed after the request was accepted: the standard error envelope under a "failed" diagnostic outcome.
import { errorEnvelope } from "./server-http-wire.js";
import type { JsonAnswer } from "./server-route-table.js";

/** The standard error envelope. */
export type FailureBody = ReturnType<typeof errorEnvelope>;

/** A failed answer with the standard error envelope; the code is also the diagnostic error code. */
export function failed(status: number, code: string, message: string): JsonAnswer<FailureBody> {
  return { kind: "answer", status, body: errorEnvelope(code, message), outcome: "failed", errorCode: code };
}

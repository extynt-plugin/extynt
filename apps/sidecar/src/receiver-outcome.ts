/** Constructors for the outcomes the in-process receivers return. */
import type { ReceiverOutcome } from "./receiver-types.js";
import { errorEnvelope } from "./server-http-wire.js";
import type { Opaque } from "./snapshot-view.js";

/** A success: the status and the body the route answers. */
export function accepted(status: number, body: Record<string, Opaque>): ReceiverOutcome {
  return { status, body, outcome: "succeeded" };
}

/** A refusal carrying the standard error envelope; its code is also the diagnostic error code. */
export function refused(status: number, code: string, message: string): ReceiverOutcome {
  return { status, body: errorEnvelope(code, message), outcome: "rejected", errorCode: code };
}

/** A refusal the route has always reported without a diagnostic error code. */
export function refusedUncoded(status: number, body: Record<string, Opaque>): ReceiverOutcome {
  return { status, body, outcome: "rejected" };
}

/** Runs a synchronous core so that a throw reaches the caller as a rejection, the way an async receiver fails. */
export function settled<T>(run: () => T): Promise<T> {
  return new Promise<T>((resolve) => resolve(run()));
}

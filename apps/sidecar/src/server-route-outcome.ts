// Turns what an in-process receiver core answers into a reply of the route table.
import type { ReceiverOutcome } from "./receiver-types.js";
import type { JsonAnswer } from "./server-route-table.js";

/** The reply a route gives for a core's outcome: its status, body and diagnostic outcome and error code. */
export function outcomeReply(outcome: ReceiverOutcome): JsonAnswer<ReceiverOutcome["body"]> {
  const reply: JsonAnswer<ReceiverOutcome["body"]> = { kind: "answer", status: outcome.status, body: outcome.body, outcome: outcome.outcome };
  return outcome.errorCode === undefined ? reply : { ...reply, errorCode: outcome.errorCode };
}

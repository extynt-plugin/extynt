/** The part of an apply or undo receipt the panel reads: the overall status, why it failed, and each change's outcome. */
import type { Infer } from "@extynt/decode";
import { fallback, number, object, skippingInvalid, string } from "@extynt/decode";

const failureDecoder = object({ message: fallback(string(), null) });

const outcomeDecoder = object({
  outcome: fallback(string(), ""),
  index: fallback(number(), -1),
  type: fallback(string(), ""),
  error: fallback(failureDecoder, null),
});

/** What the host reported for an apply or an undo. `hostError` is After Effects' own reason; `error` is the sidecar's. */
export const receiptDecoder = object({
  status: fallback(string(), null),
  reason: fallback(string(), null),
  hostError: fallback(failureDecoder, null),
  error: fallback(failureDecoder, null),
  operationOutcomes: fallback(skippingInvalid(outcomeDecoder), []),
});

/** A receipt as the panel keeps it. */
export type Receipt = Infer<typeof receiptDecoder>;
/** The host's verdict on one change of a plan. */
export type OperationOutcome = Infer<typeof outcomeDecoder>;

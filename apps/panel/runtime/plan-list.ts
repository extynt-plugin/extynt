/** A row of the sidecar's plan list: a plan's status, the facts about how it ended, and the content its card is drawn from. */
import type { Infer } from "@extynt/decode";
import { planIdDecoder } from "./ids.js";
import { planExpressionDecoder, planNoticeDecoder, planValueRowDecoder } from "./plan-content.js";
import { fallback, literal, object, skippingInvalid, string } from "@extynt/decode";

const presentationDecoder = object({
  title: fallback(string(), null),
  values: fallback(skippingInvalid(planValueRowDecoder), []),
  notices: fallback(skippingInvalid(planNoticeDecoder), []),
  warnings: fallback(skippingInvalid(string()), []),
  expressions: fallback(skippingInvalid(planExpressionDecoder), []),
  verification: fallback(object({ requiresAcknowledgement: fallback(literal(true), false) }), null),
});

const planListRowDecoder = object({
  planId: planIdDecoder,
  status: fallback(string(), ""),
  summary: fallback(string(), ""),
  presentation: fallback(presentationDecoder, null),
  droppedBecause: fallback(string(), null),
  mayHaveMutated: fallback(literal(true), false),
  postcondition: fallback(string(), null),
  updatedAt: fallback(string(), null),
  visual: fallback(literal(true), false),
  source: fallback(string(), null),
  variantSetId: fallback(string(), null),
  approvalExpired: fallback(literal(true), false),
});

/** The plan list tool's answer: the rows that are plans. An answer that is not a list is not an answer. */
export const planListDecoder = skippingInvalid(planListRowDecoder);

/** One plan as the list tool reports it. */
export type PlanListRow = Infer<typeof planListRowDecoder>;

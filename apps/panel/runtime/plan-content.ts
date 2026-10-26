/** What a plan shows the reader: the rows of what will change, the notices to read first, and any expressions. */
import { planIdDecoder } from "./ids.js";
import type { Infer } from "@extynt/decode";
import { fallback, jsonValue, literal, number, object, optional, skippingInvalid, string } from "@extynt/decode";

/** One change as the sidecar words it; `before` and `after` are whatever values the property holds, shown as short text. */
export const planValueRowDecoder = object({
  label: fallback(string(), ""),
  target: fallback(string(), ""),
  before: optional(jsonValue),
  after: optional(jsonValue),
});

/** A note the sidecar attaches to a plan; `operationIndexes` names the changes an unverified note is about. */
export const planNoticeDecoder = object({
  severity: fallback(literal("error", "unverified", "note"), "note"),
  title: string({ nonEmpty: true }),
  detail: fallback(string(), ""),
  because: fallback(string(), ""),
  action: fallback(string(), ""),
  operationIndexes: fallback(skippingInvalid(number()), []),
});

/** An expression a plan sets, shown as a short excerpt. */
export const planExpressionDecoder = object({ propertyPath: optional(string()), source: optional(string()) });

/** The fields that carry a plan's content, for decoders that hold a plan beside other fields. Rows fall back to the operation names when the sidecar sent no value rows. */
export const planContentShape = {
  rows: fallback(skippingInvalid(planValueRowDecoder), []),
  operations: fallback(skippingInvalid(string()), []),
  notices: fallback(skippingInvalid(planNoticeDecoder), []),
  warnings: fallback(skippingInvalid(string()), []),
  expressions: fallback(skippingInvalid(planExpressionDecoder), []),
  requiresAcknowledgement: fallback(literal(true), false),
} as const;


/** A plan beside its card text: the final answer of a turn carries one for each plan the turn made. */
export const planUpdateDecoder = object({
  ...planContentShape,
  planId: planIdDecoder,
  text: optional(string()),
  title: optional(string()),
  status: optional(string()),
});

/** One change as the sidecar words it. */
export type PlanValueRow = Infer<typeof planValueRowDecoder>;
/** A note attached to a plan. */
export type PlanNotice = Infer<typeof planNoticeDecoder>;
/** An expression a plan sets. */
export type PlanExpression = Infer<typeof planExpressionDecoder>;
/** A plan as a turn's final answer carries it. */
export type PlanUpdate = Infer<typeof planUpdateDecoder>;

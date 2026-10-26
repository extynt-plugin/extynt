/** The sidecar's answers to a chat turn and to the calls around it: the reply, a steer, a stop and a progress poll. */
import type { Decoder, Infer } from "@extynt/decode";
import { orchestrationDecoder } from "./orchestration.js";
import { approvalOrNull } from "./panel-approval.js";
import { pauseOrNull } from "./panel-pause.js";
import { planUpdateDecoder } from "./plan-content.js";
import { answerDetailDecoders } from "./transcript.js";
import { fallback, jsonValue, literal, map, number, object, skippingInvalid, string } from "@extynt/decode";

const MAX_TOOLS = 40;

const liveProgressFields = object({
  requestId: string(),
  label: fallback(string(), ""),
  step: fallback(number(), 0),
  usage: fallback(answerDetailDecoders.usage, null),
  reasoning: fallback(string(), ""),
  notes: fallback(skippingInvalid(string()), []),
});

const liveProgress = map(liveProgressFields, ({ notes, reasoning, ...rest }) => ({
  ...rest,
  reasoning: reasoning || notes.filter((note) => note !== "").slice(-1)[0] || "",
}));

/** Where an open turn stands: its plain label, the step it is on, what it spent, and the tail of its narration. */
export type LiveProgress = Infer<typeof liveProgress>;

/** The answer to a progress poll. */
export const progressReplyDecoder = object({ ok: fallback(literal(true), false), progress: fallback(liveProgress, null) });

/** The answer to a request for the reply that closed a job: its text, or nothing while the job has not finished. */
export const closingReplyDecoder = object({ ok: fallback(literal(true), false), closing: fallback(string(), "") });

/** The answer to a steer. */
export const steerReplyDecoder = object({ ok: fallback(literal(true), false) });

/** The answer to Stop: what became of the job, and the sidecar's own words. */
export const stopReplyDecoder = object({ outcome: fallback(string(), null), message: fallback(string(), null) });

const chatReplyFields = object({
  ok: fallback(literal(true), false),
  answer: fallback(string(), ""),
  outcome: fallback(string(), null),
  model: fallback(string(), ""),
  error: fallback(object({ message: string() }), null),
  provider: fallback(object({ label: fallback(string(), ""), displayName: fallback(string(), "") }), null),
  tools: fallback(map(skippingInvalid(answerDetailDecoders.tools), (kept) => kept.slice(0, MAX_TOOLS)), []),
  reasoning: fallback(skippingInvalid(answerDetailDecoders.reasoning), []),
  usage: fallback(answerDetailDecoders.usage, null),
  plans: fallback(skippingInvalid(planUpdateDecoder), []),
  fallback: fallback(object({ from: string(), reason: string() }), null),
  orchestration: orchestrationDecoder,
  requestId: fallback(string(), null),
  projectLinks: fallback(skippingInvalid(jsonValue), []),
  pause: pauseOrNull,
  approval: approvalOrNull,
  failure: fallback(object({ code: fallback(string(), null) }), null),
});

/** A finished turn: the answer and everything the sidecar reports beside it. */
export type ChatReply = Infer<typeof chatReplyFields>;

/** Accepts the answer to a chat turn. */
export const chatReplyDecoder: Decoder<ChatReply> = chatReplyFields;

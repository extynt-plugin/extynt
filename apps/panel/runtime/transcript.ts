/**
 * The rows of a chat transcript: what the user said, what the model answered, the notices between them and the plans it
 * proposed. The sidecar stores them as JSON, so the same decoders read them back, row by row.
 */
import type { Decoder, Infer } from "@extynt/decode";
import { planIdDecoder } from "./ids.js";
import { approvalDecoder } from "./panel-approval.js";
import { pauseDecoder } from "./panel-pause.js";
import { planContentShape } from "./plan-content.js";
import { array, boolean, fallback, jsonValue, literal, nullable, number, object, optional, skippingInvalid, string, taggedUnion } from "@extynt/decode";
import type { Mutable } from "./wire-decoders.js";

const messageContextDecoder = object({ composition: string(), layers: fallback(skippingInvalid(string()), []), selected: fallback(number(), 0) });

/** What a message was sent with: the composition and layers selected when it left. */
export type MessageContext = Infer<typeof messageContextDecoder>;

const toolDecoder = object({ name: string(), ok: boolean(), code: optional(string()), message: optional(string()) });
const reasoningStepDecoder = object({ step: fallback(number(), 0), text: fallback(string(), ""), tools: fallback(skippingInvalid(string()), []) });
const usageDecoder = object({ inputTokens: fallback(number(), 0), cachedInputTokens: fallback(number(), 0), totalTokens: fallback(number(), 0), outputTokens: fallback(number(), 0) });

/** A tool the model called during a turn, with the error code when it was refused. */
export type ChatTool = Infer<typeof toolDecoder>;
/** The reasoning of one model step and the tools it chose. */
export type ReasoningStep = Infer<typeof reasoningStepDecoder>;
/** What a turn cost in tokens. */
export type TokenUsage = Infer<typeof usageDecoder>;

/** The decoders for the parts of an answer that a Details disclosure shows. */
export const answerDetailDecoders = { tools: toolDecoder, reasoning: reasoningStepDecoder, usage: usageDecoder } as const;

const bookkeeping = {
  _logId: optional(string()),
  _logRevision: optional(number()),
  _logFingerprint: optional(string()),
  _logAckRevision: optional(number()),
  transient: optional(boolean()),
  at: optional(number()),
} as const;

const userRow = object({
  ...bookkeeping,
  kind: literal("user"),
  text: string(),
  requestId: optional(string()),
  projectLinks: optional(array(jsonValue)),
  context: optional(messageContextDecoder),
  captureId: optional(string()),
  refIds: optional(array(string())),
  steer: optional(boolean()),
  steerId: optional(string()),
  delivery: optional(literal("pending", "delivered", "failed")),
  failed: optional(boolean()),
});

const answerShape = {
  ...bookkeeping,
  text: string(),
  failed: optional(boolean()),
  retry: optional(string()),
  sendAnyway: optional(string()),
  tools: optional(array(toolDecoder)),
  reasoning: optional(array(reasoningStepDecoder)),
  usage: optional(usageDecoder),
  provider: optional(string()),
  requestId: optional(string()),
  projectLinks: optional(array(jsonValue)),
  pause: optional(pauseDecoder),
  approval: optional(approvalDecoder),
} as const;

const assistantRow = object({ ...answerShape, kind: literal("assistant") });
const errorRow = object({ ...answerShape, kind: literal("error") });

const noticeRow = object({
  ...bookkeeping,
  kind: literal("notice"),
  text: string(),
  tone: fallback(string(), ""),
  action: fallback(nullable(literal("open-diagnostics", "open-debug", "open-model", "switch-model")), null),
});

const planCardShape = {
  ...planContentShape,
  text: string(),
  planId: planIdDecoder,
  status: optional(string()),
  result: optional(nullable(string())),
} as const;

const planCardDecoder = object(planCardShape);

const planRow = object({ ...bookkeeping, ...planCardShape, kind: literal("plan") });

const rowDecoder = taggedUnion("kind", { user: userRow, assistant: assistantRow, error: errorRow, notice: noticeRow, plan: planRow });

/** One row of a chat. Rows are updated in place as a turn goes on: a delivery mark, a status, the links a turn made. */
export type TranscriptRow = Mutable<Infer<typeof rowDecoder>>;
/** What a plan card is drawn from: the plan's content, its text and the status it was last seen in. */
export type PlanCard = Mutable<Infer<typeof planCardDecoder>>;
/** The row of a plan card. */
export type PlanRow = Extract<TranscriptRow, { kind: "plan" }>;
/** The row of a message that carries an answer: the model's reply or its error. */
export type AnswerRow = Extract<TranscriptRow, { kind: "assistant" | "error" }>;

/** A row before it is placed in a chat, which stamps the time. */
export type NewRow = TranscriptRow extends infer Row ? (Row extends TranscriptRow ? Omit<Row, "at"> : never) : never;

/** A stored chat's rows: the ones that fit a row are kept, the rest are dropped. */
export const transcriptDecoder: Decoder<ReadonlyArray<TranscriptRow>> = fallback(skippingInvalid(rowDecoder), []);

/** What a notice can offer beside its words. */
export type NoticeAction = Extract<NewRow, { kind: "notice" }>["action"];

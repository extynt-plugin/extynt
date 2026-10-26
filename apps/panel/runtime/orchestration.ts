/** The orchestration summary a turn's answer carries: which specialists were consulted, what each did, and which were unavailable. */
import type { Decoder, Infer } from "@extynt/decode";
import { fallback, literal, map, number, object, skippingInvalid, string } from "@extynt/decode";

const MAX_ROLE_LABEL = 80;
const MAX_STREAM_CHARS = 8000;

const roleDecoder = string({ pattern: /^[a-z][a-z0-9-]{0,63}$/ });
const streamText: Decoder<string> = map(fallback(string(), ""), (text) => text.slice(-MAX_STREAM_CHARS));

const activityDecoder = object({
  role: roleDecoder,
  status: literal("running", "completed", "failed"),
  turn: fallback(number(), 0),
  text: streamText,
  reasoning: streamText,
});

const registryDecoder = map(object({ role: roleDecoder, label: string() }), ({ role, label }) => ({ role, label: label.trim().slice(0, MAX_ROLE_LABEL) }));

const NO_ROLES: ReadonlyArray<string> = [];
const NO_UNAVAILABLE: ReadonlyArray<{ readonly role: string }> = [];

const summaryDecoder = object({
  owner: literal("orchestrator-validator"),
  submissionPolicy: literal("orchestrator-only"),
  mode: literal("delegated", "partial", "single-agent-fallback"),
  delegates: fallback(skippingInvalid(roleDecoder), NO_ROLES),
  unavailable: fallback(skippingInvalid(object({ role: roleDecoder })), NO_UNAVAILABLE),
  activity: fallback(skippingInvalid(activityDecoder), []),
  registry: map(fallback(skippingInvalid(registryDecoder), []), (entries) => entries.filter((entry) => entry.label !== "")),
});

/** The specialists a turn consulted, as the chat roster shows them. */
export type OrchestrationSummary = Infer<typeof summaryDecoder>;

/** The summary, or null for anything that is not one. */
export const orchestrationDecoder: Decoder<OrchestrationSummary | null> = fallback(summaryDecoder, null);

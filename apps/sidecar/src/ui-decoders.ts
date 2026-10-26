// Decoders for what the panel sends and what the UI store keeps on disk: preferences, sessions and the current-session choice.
import { languageChoiceDecoder } from "@extynt/ui-text";
import { array, boolean, literal, map, nullable, number, object, optional, record, refine, string, strictObject, type Decoder, type JsonValue, jsonValueWithin } from "@extynt/decode";
import type { UiMessage, UiPrefsPatch, UiSession, UiSessionInput } from "./ui-contract.js";

const MAX_TITLE = 200, MAX_PROJECT = 300, MAX_KIND = 32, MAX_TEXT = 200_000, MAX_MESSAGE_NESTING = 11, MAX_STORED_NESTING = 16;
const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** A preferences patch: only the known preferences, each well typed; any other key is refused. */
export const prefsPatch: Decoder<UiPrefsPatch> = strictObject({
  askBeforeApplying: optional(literal("risky", "always", "never")),
  suggestPrompts: optional(boolean()),
  showThumbnails: optional(boolean()),
  rateLimit: optional(boolean()),
  diagnostics: optional(boolean()),
  language: optional(languageChoiceDecoder),
});

function isUiMessage(fields: Readonly<Record<string, JsonValue>>): fields is UiMessage {
  return typeof fields.kind === "string" && fields.kind.length <= MAX_KIND && typeof fields.text === "string" && fields.text.length <= MAX_TEXT;
}

const uiMessage: Decoder<UiMessage> = refine(record(string(), jsonValueWithin(MAX_MESSAGE_NESTING)), isUiMessage, "message with a kind and a text");

/** The body of a session PUT: `id`, when present, is checked against the path by the route; the server stamps `updatedAt` and `messageCount` itself. */
export const sessionBody: Decoder<UiSessionInput & { readonly id?: string }> = object({
  id: optional(string()),
  title: string({ maxLength: MAX_TITLE }),
  project: optional(nullable(string({ maxLength: MAX_PROJECT }))),
  createdAt: optional(number({ min: 0 })),
  messages: array(uiMessage),
});

/** One session read back from disk; it must be exactly what a PUT would have written. */
export const storedSession: Decoder<UiSession> = map(
  object({ id: string({ pattern: SESSION_ID }), title: string({ maxLength: MAX_TITLE }), project: optional(nullable(string({ maxLength: MAX_PROJECT }))), createdAt: number({ min: 0 }), updatedAt: number({ min: 0 }), messages: array(uiMessage) }),
  (stored) => ({ ...stored, project: stored.project ?? null }),
);

/** The sessions file on disk as a list of entries each checked on its own, so one damaged session does not cost the others. */
export const sessionsEnvelope: Decoder<{ readonly sessions: readonly JsonValue[]; readonly currentSessionId?: JsonValue }> = object({
  sessions: array(jsonValueWithin(MAX_STORED_NESTING)),
  currentSessionId: optional(jsonValueWithin(0)),
});

/** The body that selects the current session: a stored session's id, or null for none. */
export const currentSessionBody: Decoder<{ readonly id: string | null }> = object({ id: nullable(string({ pattern: SESSION_ID })) });

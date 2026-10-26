/**
 * The shapes the sidecar's UI routes answer with (apps/sidecar/src/ui-contract.ts is the other half) as decoders, and
 * the event frames of the live stream. Where the sidecar may send less than the panel wants, the decoder says what the
 * panel assumes instead.
 */
import type { Decoder, Infer } from "@extynt/decode";
import { languageChoiceDecoder, languageDecoder, type Language, type LanguageChoice } from "@extynt/ui-text";
import { planIdDecoder, sessionIdDecoder } from "./ids.js";
import { quarantineDecoder } from "./native-quarantine.js";
import { jobsDecoder, mcpCallsDecoder } from "./ui-jobs.js";
import { transcriptDecoder } from "./transcript.js";
import { boolean, fallback, literal, map, number, object, skippingInvalid, string } from "@extynt/decode";

const AUTOMATIC: LanguageChoice = "auto";
const ENGLISH: Language = "en";

const prefsDecoder = object({
  askBeforeApplying: literal("risky", "always", "never"),
  suggestPrompts: boolean(),
  showThumbnails: boolean(),
  rateLimit: boolean(),
  diagnostics: boolean(),
  language: fallback(languageChoiceDecoder, AUTOMATIC),
});

const interfaceLanguageDecoder = fallback(languageDecoder, ENGLISH);

/** The reader's switches in Settings. Accepts only a complete set. */
export type UiPrefs = Infer<typeof prefsDecoder>;

/** What the panel assumes until the sidecar says otherwise. */
export const DEFAULT_PREFS: UiPrefs = { askBeforeApplying: "risky", suggestPrompts: true, showThumbnails: true, rateLimit: true, diagnostics: false, language: AUTOMATIC };

const stallDecoder = object({
  verdict: literal("ae-busy", "plugin-unresponsive", "slow"),
  waitedMs: fallback(number(), 0),
  idleAgeMs: fallback(number(), null),
  dialog: fallback(object({ title: string({ nonEmpty: true }), sinceMs: fallback(number(), 0) }), null),
});

const hostDecoder = object({
  state: literal("offline", "connecting", "online", "stalled", "closing"),
  since: fallback(number(), 0),
  pluginVersion: fallback(string(), null),
  aeVersion: fallback(string(), null),
  experimental: fallback(literal(true), false),
  idleAgeMs: fallback(number(), null),
  stall: fallback(stallDecoder, null),
  busyKind: fallback(string(), null),
});

/** After Effects' side of the link: connected or not, the versions, and what a stalled call is waiting on. */
export type HostStatus = Infer<typeof hostDecoder>;

const MAX_LAYER_NAMES = 8;
const MAX_KINDS = 16;
const NO_KINDS: ReadonlyArray<string> = [];

const focusDecoder = object({
  project: string(),
  compositionId: fallback(string(), null),
  compositionName: fallback(string(), null),
  selected: number(),
  layerNames: fallback(skippingInvalid(string(), MAX_LAYER_NAMES), []),
  kinds: fallback(skippingInvalid(string(), MAX_KINDS), NO_KINDS),
  selectionFingerprint: fallback(string(), null),
  at: fallback(number(), 0),
});

/** The open composition and the selected layers; `kinds` and the fingerprint key the suggestions. */
export type UiFocus = Infer<typeof focusDecoder>;

const sessionSummaryShape = {
  id: sessionIdDecoder,
  title: fallback(string(), ""),
  project: fallback(string(), null),
  createdAt: fallback(number(), 0),
  updatedAt: fallback(number(), 0),
} as const;

const sessionSummaryDecoder = object({ ...sessionSummaryShape, messageCount: fallback(number(), 0) });

/** A saved chat as the list shows it. */
export type UiSessionSummary = Infer<typeof sessionSummaryDecoder>;

const sessionDecoder = object({ ...sessionSummaryShape, messages: transcriptDecoder });

/** A saved chat with its rows. */
export type UiSession = Infer<typeof sessionDecoder>;

const bootstrapFields = object({
  ok: literal(true),
  sidecarVersion: fallback(string(), ""),
  mcpVersion: fallback(string(), ""),
  uiBuild: fallback(string(), null),
  host: hostDecoder,
  hostInstanceId: fallback(string(), null),
  awaitingSnapshot: fallback(literal(true), false),
  interfaceLanguage: interfaceLanguageDecoder,
  prefs: prefsDecoder,
  currentSessionId: fallback(sessionIdDecoder, null),
  nativeAccessQuarantine: quarantineDecoder,
  focus: fallback(focusDecoder, null),
  project: fallback(string(), null),
  activity: jobsDecoder,
});

/** Everything the sidecar knows when the panel asks at start, and again every second while the stream is down. */
export const bootstrapDecoder = map(bootstrapFields, ({ ok, activity, ...rest }) => ({ ...rest, jobs: activity }));
/** The sidecar's version, the host link, the preferences, the focus and the jobs running now. */
export type Bootstrap = Infer<typeof bootstrapDecoder>;

/** The answer to a preference change: the full set as the sidecar now holds it and the language it now speaks. */
export const prefsReplyDecoder = map(object({ prefs: prefsDecoder, interfaceLanguage: interfaceLanguageDecoder }), ({ prefs, interfaceLanguage }) => ({ prefs, interfaceLanguage }));
/** The preferences and the interface language a preference change left. */
export type PrefsReply = Infer<typeof prefsReplyDecoder>;

/** The saved chats, newest first, and the one the sidecar last had open. */
export const sessionListDecoder = map(
  object({ ok: literal(true), sessions: skippingInvalid(sessionSummaryDecoder), currentSessionId: fallback(sessionIdDecoder, null) }),
  ({ sessions, currentSessionId }) => ({ sessions, currentSessionId }),
);
/** The list of saved chats. */
export type SessionList = Infer<typeof sessionListDecoder>;

/** The answer to opening or saving one chat. */
export const sessionReplyDecoder: Decoder<UiSession> = map(object({ ok: literal(true), session: sessionDecoder }), (reply) => reply.session);

/** Where the chat-log export was written and how many chats it holds. */
export const chatExportDecoder = map(
  object({ ok: literal(true), path: string(), sessions: fallback(number(), 0) }),
  ({ path, sessions }) => ({ path, sessions }),
);

const undoDecoder = object({ available: fallback(literal(true), false), reason: fallback(string(), null), code: fallback(string(), null) });

type UndoVerdict = Infer<typeof undoDecoder>;

const changeDecoder = object({ seq: fallback(number(), 0), reason: fallback(string(), "state"), planId: fallback(planIdDecoder, null) });

/** One frame of /v1/ui/events, by the event name the frame carries. */
export type UiEvent =
  | { readonly type: "activity"; readonly jobs: Infer<typeof jobsDecoder> }
  | { readonly type: "mcp"; readonly calls: Infer<typeof mcpCallsDecoder> }
  | { readonly type: "host"; readonly host: HostStatus; readonly hostInstanceId: string | null; readonly nativeAccessQuarantine: Infer<typeof quarantineDecoder>; readonly awaitingSnapshot: boolean; readonly interfaceLanguage: Infer<typeof interfaceLanguageDecoder> }
  | { readonly type: "focus"; readonly focus: UiFocus | null }
  | { readonly type: "change"; readonly seq: number; readonly reason: string; readonly planId: Infer<typeof changeDecoder>["planId"] }
  | { readonly type: "undo"; readonly planId: Infer<typeof planIdDecoder>; readonly undo: UndoVerdict }
  | { readonly type: "plans"; readonly reason: string; readonly planId: Infer<typeof changeDecoder>["planId"] }
  | { readonly type: "closing"; readonly requestId: string; readonly text: string }
  | { readonly type: "thumbs"; readonly planId: Infer<typeof planIdDecoder> }
  | { readonly type: "preview"; readonly setId: string }
  | { readonly type: "decision"; readonly reason: "open" | "changed" };

const EVENT_DECODERS: ReadonlyMap<string, Decoder<UiEvent>> = new Map<string, Decoder<UiEvent>>([
  ["activity", map(jobsDecoder, (jobs): UiEvent => ({ type: "activity", jobs }))],
  ["mcp", map(mcpCallsDecoder, (calls): UiEvent => ({ type: "mcp", calls }))],
  [
    "host",
    map(
      object({ host: hostDecoder, hostInstanceId: fallback(string(), null), nativeAccessQuarantine: quarantineDecoder, awaitingSnapshot: fallback(literal(true), false), interfaceLanguage: interfaceLanguageDecoder }),
      (frame): UiEvent => ({ type: "host", ...frame }),
    ),
  ],
  ["focus", map(object({ focus: fallback(focusDecoder, null) }), (frame): UiEvent => ({ type: "focus", focus: frame.focus }))],
  ["change", map(changeDecoder, (frame): UiEvent => ({ type: "change", ...frame }))],
  ["undo", map(object({ planId: planIdDecoder, undo: undoDecoder }), (frame): UiEvent => ({ type: "undo", ...frame }))],
  ["plans", map(object({ reason: fallback(string(), "state"), planId: fallback(planIdDecoder, null) }), (frame): UiEvent => ({ type: "plans", ...frame }))],
  ["closing", map(object({ requestId: string({ nonEmpty: true }), text: string({ nonEmpty: true }) }), (frame): UiEvent => ({ type: "closing", ...frame }))],
  ["thumbs", map(object({ planId: planIdDecoder }), (frame): UiEvent => ({ type: "thumbs", planId: frame.planId }))],
  ["preview", map(object({ setId: string({ nonEmpty: true }) }), (frame): UiEvent => ({ type: "preview", setId: frame.setId }))],
  ["decision", map(object({ reason: literal("open", "changed") }), (frame): UiEvent => ({ type: "decision", reason: frame.reason }))],
]);

/** The decoder for the event a frame names; null for a name the panel does not know. */
export function eventDecoderFor(name: string): Decoder<UiEvent> | null {
  return EVENT_DECODERS.get(name) ?? null;
}

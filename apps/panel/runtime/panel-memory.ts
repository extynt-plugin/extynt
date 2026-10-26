/**
 * "Memory" in Settings: what the panel shows and sends for effect value notes. Decoders for the sidecar's /v1/notes answers
 * and pure derivations from them: the plain-words sentence for each refusal (an error code is never shown), the request
 * bodies, and the two-press rule for anything that deletes. Sentences take the translator, so a line can be said again in
 * the language the panel speaks when it changes.
 */
import type { Decoder, Infer } from "@extynt/decode";
import type { Translate, UiKey } from "@extynt/ui-text";
import type { Reply, TransportError } from "./panel-transport.js";
import { array, boolean, decode, fallback, type JsonObject, type JsonValue, literal, map, number, object, skippingInvalid, string, union } from "@extynt/decode";
import { wholeCount } from "./wire-decoders.js";

/** One plugin the Memory section can offer to document. */
export interface PluginChoice { readonly key: string; readonly effectCount: number; readonly optedIn: boolean }
/** The sidecar's notes settings, ready to draw. */
export interface MemorySettings { readonly learnFromWork: boolean; readonly plugins: ReadonlyArray<PluginChoice>; readonly learned: LearnedCounts }
interface Failure { readonly code: string }
/** A call's answer as one shape: the decoded `ok: true` body, or why there was not one. */
export type Outcome<T> = { readonly ok: true; readonly answer: T } | { readonly ok: false; readonly failure: Failure };
/** An installed effect, for picking one by its name. */
export interface EffectChoice { readonly matchName: string; readonly displayName: string; readonly category: string }
interface ReplacedNote { readonly date: string | null; readonly reason: string | null }
/** One note as the history draws it: its kind and staleness are catalogue keys, so they are said in the current language. */
export interface NoteRow {
  readonly id: string; readonly state: "current" | "replaced"; readonly kindKey: KindKey; readonly text: string;
  readonly controlPath: string | null; readonly value: string | null; readonly stale: StaleKey | null; readonly replaced: ReplacedNote | null;
  readonly pluginKey: string | null;
}
interface NoteCaps { readonly perEffect: number; readonly perControl: number }
/** The history answer for one effect. */
export interface HistoryView {
  readonly matchName: string; readonly effectName: string; readonly pluginKey: string | null; readonly known: boolean;
  readonly current: ReadonlyArray<NoteRow>; readonly replaced: ReadonlyArray<NoteRow>; readonly noteIds: ReadonlyArray<string>; readonly caps: NoteCaps | null;
}
/** A time-limited arming of one delete button: pressing the same one again before `until` is the confirmation. */
export interface Armed { readonly key: string; readonly until: number }
/** The current note a restore replaces at the limit, and why. */
export interface RestoreSwap { readonly replaces: string; readonly reason: string }
/** How many notes or changes there are, for a line that is said in the current language. */
export interface LearnedCounts { readonly effects: number; readonly fonts: number; readonly presets: number; readonly animationSeconds: number }
interface PluginCounts { readonly total: number; readonly shown: number; readonly matched: number; readonly query: string }
/** A line of status text that is worked out again in the current language whenever the view repaints. */
export type Line = () => string;
type Pressed = { readonly fire: true; readonly armed: null } | { readonly fire: false; readonly armed: Armed };
type FailureKey = Extract<UiKey, `memory.failure.${string}`>;
/** The attempt sentences that take one reason; a plugin's own attempt names the plugin as well and is built where it is shown. */
export type AttemptKey = Exclude<Extract<UiKey, `memory.attempt.${string}`>, "memory.attempt.plugin">;
type KindKey = "memory.kind.measured" | "memory.kind.guess" | "memory.kind.note";
type StaleKey = "memory.stale.effectVersion" | "memory.stale.aeBuild" | "memory.stale.unknown";
type ReasonKey = "memory.reason.empty" | "memory.reason.long";

const CONFIRM_MS = 5000;
/** At most this many plugin rows are drawn at once; the list scrolls, and a filter narrows it. */
export const PLUGIN_ROWS = 100;
/** The filter box appears once there are more plugins than this. */
export const PLUGIN_FILTER_FROM = 8;
/** How many effect suggestions are offered at once. */
export const SUGGESTIONS = 8;
/** The sidecar accepts a one-line reason of this many characters. */
export const REASON_MAX = 160;
/** A line that says nothing. */
export const NO_LINE: Line = () => "";
/** Nothing learned yet. */
export const NOTHING_LEARNED: LearnedCounts = { effects: 0, fonts: 0, presets: 0, animationSeconds: 0 };

const KIND_KEYS: ReadonlyMap<string, KindKey> = new Map<string, KindKey>([["measured", "memory.kind.measured"], ["agent-inferred", "memory.kind.guess"]]);
const STALE_KEYS: ReadonlyMap<string, StaleKey> = new Map<string, StaleKey>([
  ["effect-version", "memory.stale.effectVersion"], ["ae-build", "memory.stale.aeBuild"]
]);
const SENTENCES: ReadonlyMap<string, FailureKey> = new Map<string, FailureKey>([
  ["STALE_PANEL_INSTANCE", "memory.failure.stalePanel"],
  ["EFFECT_NOTES_UNAVAILABLE", "memory.failure.unavailable"],
  ["EFFECT_NOTES_SETTINGS_UNSAVED", "memory.failure.settingsUnsaved"],
  ["EFFECT_NOTES_STALE", "memory.failure.stale"],
  ["EFFECT_NOTES_CAP_REACHED", "memory.failure.capReached"],
  ["EFFECT_NOTES_DOCUMENTATION_OFF", "memory.failure.documentationOff"],
  ["EFFECT_NOTES_INVALID", "memory.failure.invalid"],
  ["EFFECT_NOTES_UNKNOWN_EFFECT", "memory.failure.unknownEffect"],
  ["EFFECT_NOTES_REPLACE_INVALID", "memory.failure.replaceInvalid"],
  ["EFFECT_NOTES_NOT_FOUND", "memory.failure.notFound"],
  ["UNREACHABLE", "memory.failure.unreachable"],
  ["UNSUPPORTED", "memory.failure.unsupported"]
]);
const UNREADABLE: Failure = { code: "UNREADABLE" };

const secondsDecoder = map(fallback(number(), 0), (amount) => (amount > 0 ? amount : 0));
const learnedCountsDecoder = object({ effects: wholeCount, fonts: wholeCount, presets: wholeCount, animationSeconds: secondsDecoder });

const pluginDecoder: Decoder<PluginChoice> = map(
  object({ pluginKey: string({ nonEmpty: true }), effectCount: wholeCount, optedIn: fallback(literal(true), false) }),
  (row) => ({ key: row.pluginKey, effectCount: row.effectCount, optedIn: row.optedIn })
);
const optedInKeyDecoder = map(object({ pluginKey: string({ nonEmpty: true }) }), (row) => row.pluginKey);

function byKey(a: PluginChoice, b: PluginChoice): number {
  if (a.optedIn !== b.optedIn) return a.optedIn ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function pluginChoices(listed: ReadonlyArray<PluginChoice>, optedIn: ReadonlyArray<string>): ReadonlyArray<PluginChoice> {
  const rows = new Map<string, PluginChoice>();
  for (const row of listed) if (!rows.has(row.key)) rows.set(row.key, row);
  for (const key of optedIn) if (!rows.has(key)) rows.set(key, { key, effectCount: 0, optedIn: true });
  return [...rows.values()].sort(byKey);
}

/** The settings answer. Every plugin the sidecar lists is offered, plus any opted-in one it no longer lists (so it can still be turned off); opted-in first. */
export const memorySettingsAnswer: Decoder<MemorySettings> = map(
  object({
    ok: literal(true), learnFromWork: boolean(), plugins: fallback(skippingInvalid(pluginDecoder), []), optedIn: fallback(skippingInvalid(optedInKeyDecoder), []),
    learned: fallback(learnedCountsDecoder, NOTHING_LEARNED)
  }),
  (answer) => ({ learnFromWork: answer.learnFromWork, plugins: pluginChoices(answer.plugins, answer.optedIn), learned: answer.learned })
);

/** The answer to turning a plugin's documentation on or off. */
export const optInAnswer = object({ ok: literal(true), enabled: boolean() });
/** The answer to the learn-from-work switch. */
export const learnAnswer = object({ ok: literal(true), learnFromWork: boolean() });
/** The answer to a forget: how many items went. */
export const removedAnswer = map(object({ ok: literal(true), removed: fallback(number(), 0) }), (answer) => Math.floor(answer.removed));
/** An answer that only says it worked. */
export const acknowledged = object({ ok: literal(true) });

/** The rows to draw for what was typed: a case-insensitive match on the plugin name, capped, with how many matched in all. */
export function filterPlugins(plugins: ReadonlyArray<PluginChoice>, query: string, limit: number): { rows: ReadonlyArray<PluginChoice>; matched: number } {
  const wanted = query.trim().toLowerCase();
  const matches = wanted ? plugins.filter((plugin) => plugin.key.toLowerCase().includes(wanted)) : plugins;
  return { rows: matches.slice(0, limit), matched: matches.length };
}

/** What sits under the plugin list: why it is short, or what to do when it is empty. */
export function pluginListNote(tr: Translate, counts: PluginCounts): string {
  if (counts.total === 0) return tr("memory.plugins.none");
  if (counts.matched === 0) return tr("memory.plugins.noMatch", { query: counts.query.trim() });
  return counts.shown < counts.matched ? tr("memory.plugins.showing", { shown: counts.shown, matched: counts.matched }) : "";
}

function fallbackCode(error: TransportError): string {
  if (error.status === 404) return "UNSUPPORTED";
  if (error.status !== null) return "UNREADABLE";
  return error.unreachable || error.local ? "UNREACHABLE" : "UNREADABLE";
}

/** The failure behind a transport error: the sidecar's code when it sent one. */
export function readFailure(error: TransportError): Failure { return { code: error.code ?? fallbackCode(error) }; }

/** Why an outcome was not the answer wanted; an `ok` outcome that still lacked what was needed reads as unreadable. */
export function whyNot<T>(outcome: Outcome<T>): Failure { return outcome.ok ? UNREADABLE : outcome.failure; }

/** A transport reply as one shape: the decoded answer, or why there was not one. */
export function outcomeOf<T>(reply: Reply<T>): Outcome<T> {
  return reply.ok ? { ok: true, answer: reply.value } : { ok: false, failure: readFailure(reply.error) };
}

/** The plain-words reason for a refusal. The code itself is never shown. */
export function failureSentence(tr: Translate, failure: Failure): string {
  return tr(SENTENCES.get(failure.code) ?? "memory.failure.generic");
}

/** An attempt that failed, then why: the attempt's sentence with the reason in it. */
export function failureLine(tr: Translate, attempt: AttemptKey, failure: Failure): string {
  return tr(attempt, { reason: failureSentence(tr, failure) });
}

/** What forgetting what was learned from the user's work reports. */
export function usageForgottenLine(tr: Translate, removed: number): string {
  return removed > 0 ? tr("memory.forget.usage", { count: removed }) : tr("memory.forget.usageNone");
}

/** What forgetting notes reports. */
export function notesForgottenLine(tr: Translate, removed: number): string {
  return removed > 0 ? tr("memory.forget.notes", { count: removed }) : tr("memory.forget.notesNone");
}

/** What turning a plugin's documentation on or off says. */
export function optInLine(tr: Translate, key: string, enabled: boolean): string {
  return enabled ? tr("memory.optIn.on", { plugin: key }) : tr("memory.optIn.off", { plugin: key });
}

/** What the learn-from-work switch says. */
export function learnLine(tr: Translate, enabled: boolean): string {
  return tr(enabled ? "memory.learn.on" : "memory.learn.off");
}

/** Pressing a delete button: the first press arms it; the same button pressed again before it expires fires. Any other press re-arms. */
export function press(armed: Armed | null, key: string, now: number): Pressed {
  if (armed && armed.key === key && now <= armed.until) return { fire: true, armed: null };
  return { fire: false, armed: { key, until: now + CONFIRM_MS } };
}

function countedWords(tr: Translate, counts: LearnedCounts): string[] {
  const parts: string[] = [];
  if (counts.effects > 0) parts.push(tr("memory.learned.effects", { count: counts.effects }));
  if (counts.fonts > 0) parts.push(tr("memory.learned.fonts", { count: counts.fonts }));
  if (counts.presets > 0) parts.push(tr("memory.learned.presets", { count: counts.presets }));
  if (counts.animationSeconds > 0) parts.push(tr("memory.learned.animations", { seconds: Math.round(counts.animationSeconds * 100) / 100 }));
  return parts;
}

/** What was learned, in plain words, joined in the language's own list style; empty when nothing was. */
export function learnedWords(tr: Translate, counts: LearnedCounts): string {
  return countedWords(tr, counts).join(tr("memory.list.separator"));
}

/** The sentence under the switch for what was learned, or nothing when nothing was. */
export function learnedSentence(tr: Translate, words: string): string { return words ? tr("memory.learned.sofar", { words }) : ""; }

function dayLabel(at: number): string { return new Date(at).toISOString().slice(0, 10); }

const valueDecoder = map(fallback(union(number(), array(number(), { minLength: 1 })), null), (value) => {
  if (value === null) return null;
  return typeof value === "number" ? String(value) : value.join(", ");
});

const noteFields = object({
  id: string({ nonEmpty: true }), text: string({ nonEmpty: true }), kind: fallback(string(), ""), controlPath: fallback(string(), ""),
  value: valueDecoder, stale: fallback(literal(true), false), staleReason: fallback(string(), ""), replacedAt: fallback(number(), null), replaceReason: fallback(string(), ""), pluginKey: fallback(string(), "")
});
type NoteFields = Infer<typeof noteFields>;

/** When a replaced note was replaced and why, read from the sidecar's fields. */
export function replacedLine(tr: Translate, replaced: ReplacedNote): string {
  const { date, reason } = replaced;
  if (date && reason) return tr("memory.replaced.datedReason", { date, reason });
  if (date) return tr("memory.replaced.dated", { date });
  if (reason) return tr("memory.replaced.reason", { reason });
  return tr("memory.replaced.plain");
}

function replacedNoteOf(source: NoteFields): ReplacedNote {
  return { date: source.replacedAt === null ? null : dayLabel(source.replacedAt), reason: source.replaceReason || null };
}

function staleKeyOf(source: NoteFields): StaleKey | null {
  return source.stale ? STALE_KEYS.get(source.staleReason) ?? "memory.stale.unknown" : null;
}

function noteDecoder(state: NoteRow["state"]): Decoder<NoteRow> {
  return map(noteFields, (source) => ({
    id: source.id, state, kindKey: KIND_KEYS.get(source.kind) ?? "memory.kind.note", text: source.text, controlPath: source.controlPath || null,
    value: source.value, stale: staleKeyOf(source), replaced: state === "replaced" ? replacedNoteOf(source) : null, pluginKey: source.pluginKey || null
  }));
}

const historyCurrentDecoder = object({
  notes: fallback(skippingInvalid(noteDecoder("current")), []), noteIds: fallback(skippingInvalid(string()), []), caps: fallback(object({ perEffect: number(), perControl: number() }), null),
  effect: fallback(object({ displayName: fallback(string(), ""), pluginKey: fallback(string(), "") }), null)
});
type HistoryCurrent = Infer<typeof historyCurrentDecoder>;
const NO_CURRENT: HistoryCurrent = { notes: [], noteIds: [], caps: null, effect: null };

const historyFields = object({ ok: literal(true), current: fallback(historyCurrentDecoder, null), notes: fallback(skippingInvalid(noteDecoder("replaced")), []) });
type HistoryFields = Infer<typeof historyFields>;

function pluginOf(effect: HistoryCurrent["effect"], replaced: ReadonlyArray<NoteRow>): string | null {
  return effect?.pluginKey || replaced[0]?.pluginKey || null;
}

function viewOf(matchName: string, answer: HistoryFields): HistoryView {
  const current = answer.current ?? NO_CURRENT;
  return {
    matchName, effectName: current.effect?.displayName || matchName, pluginKey: pluginOf(current.effect, answer.notes),
    known: answer.current !== null || answer.notes.length > 0, current: current.notes, replaced: answer.notes, noteIds: current.noteIds, caps: current.caps
  };
}

/** The history answer for one effect. `known` is false when the sidecar has not learned an effect of that name and holds no notes for it. */
export function historyAnswer(matchName: string): Decoder<HistoryView> {
  return map(historyFields, (answer) => viewOf(matchName, answer));
}

function currentWords(tr: Translate, view: HistoryView): string {
  const count = view.current.length;
  return view.caps ? tr("memory.history.currentOf", { count, limit: view.caps.perEffect }) : tr("memory.history.current", { count });
}

/** One line over the lists: how many notes there are, in plain words. */
export function historySummary(tr: Translate, view: HistoryView): string {
  if (!view.known) return tr("memory.failure.unknownEffect");
  if (!view.current.length && !view.replaced.length) return tr("memory.history.empty", { effect: view.effectName });
  return tr("memory.history.summary", { effect: view.effectName, current: currentWords(tr, view), replaced: tr("memory.history.replaced", { count: view.replaced.length }) });
}

/** Bringing a replaced note back. At the limit the user also names the current note it replaces and why; the ids are the set last read. */
export function restoreBody(noteId: string, noteIds: ReadonlyArray<string>, swap?: RestoreSwap): JsonObject {
  const body = { noteId, expectedNoteIds: noteIds };
  return swap ? { ...body, replaces: swap.replaces, reason: swap.reason } : body;
}

/** Which current notes the restored one may replace: when its control is already full it must be one on that control, otherwise any. */
export function replaceCandidates(restored: NoteRow, current: ReadonlyArray<NoteRow>, caps: NoteCaps | null): ReadonlyArray<NoteRow> {
  const same = current.filter((note) => note.controlPath === restored.controlPath);
  return caps && same.length >= caps.perControl ? same : current;
}

/** A reason is one line of 1 to 160 characters. Returns the catalogue key of what is wrong with it, or null. */
export function reasonProblem(reason: string): ReasonKey | null {
  const trimmed = reason.trim();
  if (!trimmed) return "memory.reason.empty";
  return trimmed.length > REASON_MAX || /[\r\n]/.test(trimmed) ? "memory.reason.long" : null;
}

/** The request that forgets one note. */
export function forgetNoteBody(noteId: string): JsonObject { return { scope: "note", noteId }; }
/** The request that forgets every note of one effect. */
export function forgetEffectBody(matchName: string): JsonObject { return { scope: "effect", matchName }; }
/** The request that forgets every note of one plugin. */
export function forgetPluginBody(pluginKey: string): JsonObject { return { scope: "plugin", pluginKey }; }

const effectChoiceDecoder = object({
  matchName: string({ nonEmpty: true }), displayName: fallback(string(), ""), category: fallback(string(), ""), available: map(fallback(boolean(), null), (available) => available !== false)
});
const censusDecoder = object({ result: object({ installedEffects: fallback(skippingInvalid(effectChoiceDecoder), []) }) });

/** The installed effects the host census listed, for picking an effect by its name. Anything else is no list (type the match name instead). */
export function effectChoices(census: JsonValue | null): ReadonlyArray<EffectChoice> {
  const found = decode(censusDecoder, census);
  if (!found.ok) return [];
  return found.value.result.installedEffects.filter((effect) => effect.available).map((effect) => ({
    matchName: effect.matchName, displayName: effect.displayName || effect.matchName, category: effect.category
  }));
}

function matchRank(choice: EffectChoice, wanted: string): 0 | 1 | 2 {
  const name = choice.displayName.toLowerCase(), match = choice.matchName.toLowerCase();
  if (name.startsWith(wanted) || match.startsWith(wanted)) return 0;
  return name.includes(wanted) || match.includes(wanted) ? 1 : 2;
}

/** Effects whose name or match name contains what was typed, names that start with it first. */
export function suggestEffects(choices: ReadonlyArray<EffectChoice>, query: string, limit: number): ReadonlyArray<EffectChoice> {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return [];
  const starts: EffectChoice[] = [], inside: EffectChoice[] = [];
  for (const choice of choices) {
    const rank = matchRank(choice, wanted);
    if (rank === 0) starts.push(choice);
    else if (rank === 1) inside.push(choice);
  }
  return [...starts, ...inside].slice(0, limit);
}

/** The match name to look up: a typed name that is exactly one effect's name stands for that effect; anything else is taken as a match name. */
export function resolveEffect(choices: ReadonlyArray<EffectChoice>, typed: string): string {
  const wanted = typed.trim(), lower = wanted.toLowerCase();
  if (choices.some((choice) => choice.matchName === wanted)) return wanted;
  const named = choices.filter((choice) => choice.displayName.toLowerCase() === lower);
  return named.length === 1 && named[0] ? named[0].matchName : wanted;
}

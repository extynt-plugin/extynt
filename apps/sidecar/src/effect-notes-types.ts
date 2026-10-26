// Shared shapes for effect value notes (docs/architecture/effect-notes.md): note views, usage statistics, habits, caps and the coded refusal.

/** A note is measured by calibration (evidence) or inferred by the agent (a labelled guess). */
export type NoteKind = "measured" | "agent-inferred";

/** A control value a note or usage row carries: one number, or two to four. */
export type NoteValue = number | number[];

type NoteCode =
  | "EFFECT_NOTES_STALE"
  | "EFFECT_NOTES_CAP_REACHED"
  | "EFFECT_NOTES_DOCUMENTATION_OFF"
  | "EFFECT_NOTES_INVALID"
  | "EFFECT_NOTES_UNKNOWN_EFFECT"
  | "EFFECT_NOTES_REPLACE_INVALID"
  | "EFFECT_NOTES_NOT_FOUND";

/** A domain refusal. Stale and cap refusals also return the current notes, so the caller retries without another read. */
export class EffectNotesError extends Error {
  constructor(readonly code: NoteCode, message: string, readonly cap?: "effect" | "control") { super(message); }
}

interface NotesCaps { perEffect: number; perControl: number }

const DEFAULT_CAPS: NotesCaps = { perEffect: 5, perControl: 2 };
const CAP_TEXT = /^\d{1,3}$/;
const CAP_RANGE = { min: 1, max: 20 } as const;

function capFrom(raw: string | undefined, fallback: number): number {
  if (raw === undefined || !CAP_TEXT.test(raw.trim())) return fallback;
  const value = Number(raw.trim());
  return value >= CAP_RANGE.min && value <= CAP_RANGE.max ? value : fallback;
}

/** Tunable per machine with EXTYNT_NOTES_PER_EFFECT / EXTYNT_NOTES_PER_CONTROL (integers 1..20); anything else keeps the default. */
export function effectNoteCaps(env: Readonly<Record<string, string | undefined>> = process.env): NotesCaps {
  return { perEffect: capFrom(env.EXTYNT_NOTES_PER_EFFECT, DEFAULT_CAPS.perEffect), perControl: capFrom(env.EXTYNT_NOTES_PER_CONTROL, DEFAULT_CAPS.perControl) };
}

/** An installed effect on the current host: the identity every note and usage row hangs from. */
export interface EffectRef { hostKey: string; matchName: string; displayName: string; category: string; version: string | null; pluginKey: string }

/** One control of an effect as After Effects reported it; a fact, never a note. */
export interface ObservedControl {
  controlPath: string; matchName: string; name: string; group: boolean; hidden: boolean; valueType: string; units: string | null;
  minimum: number | null; maximum: number | null; defaultValue: NoteValue | null; canVaryOverTime: boolean | null; menu: string[];
  defaultPosition: number | null;
}

/** A current note as the agent reads it, with its provenance and staleness. */
export interface NoteView {
  id: string; kind: NoteKind; trust: "evidence" | "labelled-guess"; controlPath: string | null; text: string; value: NoteValue | null;
  effectVersion: string | null; aeBuild: string; createdAt: number; stale: boolean; staleReason: "effect-version" | "ae-build" | null;
}

/** A note as the user's audit sees it, current or replaced. */
export interface HistoryNoteView extends NoteView { state: "current" | "replaced"; replacedBy: string | null; replaceReason: string | null; replacedAt: number | null; matchName: string; pluginKey: string }

/** Statistics over the scalar values one source recorded for a control. */
export interface UsageStats { count: number; vectorCount: number; min: number | null; max: number | null; median: number | null; recent: Array<NoteValue> }

/** What the user kept and what snapshots showed for one control. */
export interface ControlUsage { controlPath: string; kept: UsageStats | null; seen: UsageStats | null }

/** The agent's read of an effect: observed facts, labelled notes, computed usage. */
export interface NotesReadResponse {
  ok: true;
  effect: { matchName: string; displayName: string; category: string; version: string | null; pluginKey: string };
  host: { key: string; aeBuild: string };
  observed: { trust: "fact"; rangeNote: string; probed: boolean; observedAt: number | null; controls: ObservedControl[] };
  notes: NoteView[]; noteIds: string[]; usage: ControlUsage[]; effectUsage: EffectUsageRank | null; animationHabits: AnimationHabits | null; caps: NotesCaps; documentationEnabled: boolean; writeAuthorizing: false;
}

/** A refusal; stale, cap and replace refusals carry the current notes. */
export interface NoteFailure { ok: false; code: string; message: string; cap?: "effect" | "control"; current?: NotesReadResponse; writeAuthorizing: false }

/** A success shaped as the operation's payload, or a refusal. */
export type NotesResult<T> = (T & { ok: true; writeAuthorizing: false }) | NoteFailure;

/** A value the user kept in a verified plan (`slot` places it inside the plan). */
export interface KeptUsageInput { planId: string; matchName: string; controlPath: string; value: NoteValue; slot?: string; at?: number }

/** A value an accepted snapshot showed; `key` names where, so a re-read replaces it. */
export interface SeenUsageInput { matchName: string; controlPath: string; value: NoteValue; key: string; at?: number }

/** What the ranking counts: effects the user added or had, the fonts they set, the presets they applied. */
export type UsageKind = "effect" | "font" | "preset";

/** An effect, font or preset a verified plan used (one event per plan, name and slot). */
export interface KeptEventInput { planId: string; kind: UsageKind; name: string; slot?: string; at?: number }

/** Something present in an accepted snapshot; `key` names where (layer), so a re-read never double-counts. */
export interface SeenEventInput { kind: UsageKind; name: string; key: string; at?: number }

/** `kept` = distinct plans that used it, `seen` = distinct layers carrying it, `used` = their sum. */
export interface UsageRank { name: string; displayName: string; kept: number; seen: number; used: number }

/** One effect's standing among the effects the user has used. */
export interface EffectUsageRank { rank: number; kept: number; seen: number; used: number }

/** One animated property of a verified, not-undone plan: how long its keyframes span, how many there are, how they ease. */
export interface HabitSampleInput { planId: string; slot?: string; propertyKind: string; duration: number; keyframes: number; easing: string; influence?: number | null; at?: number }

/** What the user's animations usually look like for one property kind (or overall). A preference only. */
export interface HabitKind { kind: string; samples: number; medianSeconds: number; easing: string; keyframes: number; influence: number | null }

/** The user's animation habits overall and per property kind. */
export interface AnimationHabits { overall: Omit<HabitKind, "kind"> | null; kinds: HabitKind[] }

/** Counts for the Memory settings line "Learned so far". */
export interface LearnedSummary { effects: number; fonts: number; presets: number; animationSeconds: number | null }

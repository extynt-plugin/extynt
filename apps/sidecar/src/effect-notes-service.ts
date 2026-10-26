// What the tools, the panel routes and the receipt and snapshot hooks call: notes and usage over the storage seam, with the learning setting applied.
import type { JsonValue } from "@extynt/decode";
import type { GraphPersistence } from "./graph-store.js";
import type { OptInView } from "./effect-notes-optin.js";
import type { EffectNotesSettings } from "./effect-notes-settings.js";
import type { EffectNotesPersistence, UsageRecorded } from "./effect-notes-store.js";
import type {
  AnimationHabits, HabitSampleInput, HistoryNoteView, KeptEventInput, KeptUsageInput, LearnedSummary, NoteFailure, NoteView, NotesReadResponse, NotesResult, SeenEventInput,
  SeenUsageInput, UsageKind, UsageRank,
} from "./effect-notes-types.js";
import type { NoteWritten } from "./effect-notes-write.js";

interface EffectNotesServiceOptions { graph: GraphPersistence | undefined; settings: EffectNotesSettings | undefined; now: () => number }

type NotesSettingsView = NotesResult<OptInView & { learnFromWork: boolean; learned: LearnedSummary | null }>;

const UNAVAILABLE: NoteFailure = { ok: false, code: "EFFECT_NOTES_UNAVAILABLE", message: "Effect notes storage is not available in this sidecar.", writeAuthorizing: false };

type Batch<Item> = Item | readonly Item[];

function count<Item>(input: Batch<Item>): number {
  return Array.isArray(input) ? input.length : 1;
}

/** Notes and usage for the sidecar. Settings gate usage recording; nothing here reads or writes the plan, apply or verification path. */
export class EffectNotesService {
  constructor(private readonly options: EffectNotesServiceOptions) {}

  private get store(): EffectNotesPersistence | undefined {
    return this.options.graph?.effectNotes;
  }

  private learned<Item>(input: Batch<Item>, record: (store: EffectNotesPersistence, at: number) => NotesResult<UsageRecorded>): NotesResult<UsageRecorded> {
    if (!this.learnFromWork()) return { ok: true, recorded: 0, skipped: count(input), invalid: 0, writeAuthorizing: false };
    const store = this.store;
    return store ? record(store, this.options.now()) : UNAVAILABLE;
  }

  learnFromWork(): boolean {
    return this.options.settings?.learnFromWork() ?? true;
  }

  read(input: JsonValue): NotesReadResponse | NoteFailure {
    const result = this.store?.read(input) ?? UNAVAILABLE;
    return result.ok ? { ...result, animationHabits: this.animationHabits() } : result;
  }

  write(note: JsonValue): NotesResult<NoteWritten> {
    return this.store?.write(note, this.options.now()) ?? UNAVAILABLE;
  }

  recordMeasuredNote(note: JsonValue): NotesResult<NoteWritten> {
    return this.store?.recordMeasuredNote(note, this.options.now()) ?? UNAVAILABLE;
  }

  audit(input: JsonValue): NotesResult<{ notes: HistoryNoteView[] }> {
    return this.store?.audit(input) ?? UNAVAILABLE;
  }

  restore(input: JsonValue): NotesResult<NotesReadResponse & { restored: NoteView }> {
    return this.store?.restore(input, this.options.now()) ?? UNAVAILABLE;
  }

  forget(scope: JsonValue): NotesResult<{ removed: number }> {
    return this.store?.forget(scope) ?? UNAVAILABLE;
  }

  setPluginOptIn(input: JsonValue): NotesResult<{ pluginKey: string; enabled: boolean }> {
    return this.store?.setPluginOptIn(input, this.options.now()) ?? UNAVAILABLE;
  }

  settingsView(): NotesSettingsView {
    const view = this.store?.optIns();
    if (!view?.ok) return view ?? UNAVAILABLE;
    const learned = this.store?.learned();
    return { ...view, learnFromWork: this.learnFromWork(), learned: learned?.ok ? learned.learned : null };
  }

  setLearnFromWork(value: boolean): NotesResult<{ learnFromWork: boolean }> {
    if (!this.options.settings?.setLearnFromWork(value)) return { ok: false, code: "EFFECT_NOTES_SETTINGS_UNSAVED", message: "The setting could not be saved; it is unchanged.", writeAuthorizing: false };
    return { ok: true, learnFromWork: value, writeAuthorizing: false };
  }

  recordKeptUsage(input: Batch<KeptUsageInput>): NotesResult<UsageRecorded> {
    return this.learned(input, (store, at) => store.recordKeptUsage(input, at));
  }

  recordSeenUsage(input: Batch<SeenUsageInput>): NotesResult<UsageRecorded> {
    return this.learned(input, (store, at) => store.recordSeenUsage(input, at));
  }

  recordKeptEvents(input: Batch<KeptEventInput>): NotesResult<UsageRecorded> {
    return this.learned(input, (store, at) => store.recordKeptEvents(input, at));
  }

  recordSeenEvents(input: Batch<SeenEventInput>): NotesResult<UsageRecorded> {
    return this.learned(input, (store, at) => store.recordSeenEvents(input, at));
  }

  recordHabitSamples(input: Batch<HabitSampleInput>): NotesResult<UsageRecorded> {
    return this.learned(input, (store, at) => store.recordHabitSamples(input, at));
  }

  topUsage(kind: UsageKind, limit: number): UsageRank[] {
    if (!this.learnFromWork()) return [];
    const result = this.store?.rankedUsage({ kind, limit });
    return result?.ok ? result.ranked : [];
  }

  animationHabits(): AnimationHabits | null {
    if (!this.learnFromWork()) return null;
    const result = this.store?.animationHabits();
    return result?.ok ? result.habits : null;
  }

  unrecordPlanUsage(planId: string): NotesResult<{ removed: number }> {
    return this.store?.unrecordPlanUsage(planId, this.options.now()) ?? UNAVAILABLE;
  }

  forgetUsage(): NotesResult<{ removed: number }> {
    return this.store?.forgetUsage() ?? UNAVAILABLE;
  }
}

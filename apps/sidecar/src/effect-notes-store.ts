// The notes storage seam: each operation runs in its own transaction on the catalogue file and answers with a result, never a throw.
import { decode, type Decoder, type JsonValue } from "@extynt/decode";
import type { DatabaseSync } from "node:sqlite";
import { auditNotes, forgetNotes, restoreNote } from "./effect-notes-history.js";
import {
  auditRequest, forgetRequest, habitSampleRecord, keptEventRecord, keptUsageRecord, noteWriteRequest, optInRequest, restoreRequest, seenEventRecord, seenUsageRecord,
} from "./effect-notes-input.js";
import { optInView, setPluginOptIn, type OptInView } from "./effect-notes-optin.js";
import { noteFailure, readEffectNotes, withRequest } from "./effect-notes-read.js";
import { rankedUsage, recordKeptEvent, recordSeenEvent, trimEvents } from "./effect-notes-events.js";
import { learnedSummary } from "./effect-notes-summary.js";
import { readHabits, recordHabitSample, removeHabitSamples, trimHabitSamples } from "./effect-notes-habits.js";
import { forgetAllUsage, recordKeptUsage, recordSeenUsage, unrecordPlanUsage } from "./effect-notes-usage.js";
import { writeEffectNote, type NoteWritten } from "./effect-notes-write.js";
import {
  EffectNotesError, type AnimationHabits, type HabitSampleInput, type HistoryNoteView, type KeptEventInput, type KeptUsageInput, type LearnedSummary, type NoteFailure,
  type NoteView, type NotesReadResponse, type NotesResult, type SeenEventInput, type SeenUsageInput, type UsageKind, type UsageRank,
} from "./effect-notes-types.js";

/** How a batch of usage records went: stored, skipped (undone plan) or refused as malformed. */
export type UsageRecorded = { recorded: number; skipped: number; invalid: number };

/** Every call answers with a result; storage trouble is a coded refusal, never a throw. Request objects are decoded at this seam. */
export interface EffectNotesPersistence {
  read(input: JsonValue): NotesReadResponse | NoteFailure;
  write(note: JsonValue, at: number): NotesResult<NoteWritten>;
  recordMeasuredNote(note: JsonValue, at: number): NotesResult<NoteWritten>;
  audit(input: JsonValue): NotesResult<{ notes: HistoryNoteView[] }>;
  restore(input: JsonValue, at: number): NotesResult<NotesReadResponse & { restored: NoteView }>;
  forget(scope: JsonValue): NotesResult<{ removed: number }>;
  setPluginOptIn(input: JsonValue, at: number): NotesResult<{ pluginKey: string; enabled: boolean }>;
  optIns(): NotesResult<OptInView>;
  recordKeptUsage(input: KeptUsageInput | readonly KeptUsageInput[], at: number): NotesResult<UsageRecorded>;
  recordSeenUsage(input: SeenUsageInput | readonly SeenUsageInput[], at: number): NotesResult<UsageRecorded>;
  recordKeptEvents(input: KeptEventInput | readonly KeptEventInput[], at: number): NotesResult<UsageRecorded>;
  recordSeenEvents(input: SeenEventInput | readonly SeenEventInput[], at: number): NotesResult<UsageRecorded>;
  recordHabitSamples(input: HabitSampleInput | readonly HabitSampleInput[], at: number): NotesResult<UsageRecorded>;
  animationHabits(): NotesResult<{ habits: AnimationHabits | null }>;
  learned(): NotesResult<{ learned: LearnedSummary }>;
  rankedUsage(input: { kind: UsageKind; limit: number }): NotesResult<{ ranked: UsageRank[] }>;
  unrecordPlanUsage(planId: string, at: number): NotesResult<{ removed: number }>;
  forgetUsage(): NotesResult<{ removed: number }>;
}

interface NotesRunner { run<T>(mode: "read" | "write", work: (database: DatabaseSync) => T): T | NoteFailure }

function isBatch<T>(input: T | readonly T[]): input is readonly T[] {
  return Array.isArray(input);
}

function many<T>(input: T | readonly T[]): readonly T[] {
  return isBatch(input) ? input : [input];
}

function ok<T>(value: T): T & { ok: true; writeAuthorizing: false } {
  return Object.assign({}, value, { ok: true, writeAuthorizing: false } as const);
}

function applyUsage<Input, Item extends { at?: number }>(items: readonly Input[], input: { decoder: Decoder<Item>; at: number; record: (record: Item) => boolean }): UsageRecorded {
  const total: UsageRecorded = { recorded: 0, skipped: 0, invalid: 0 };
  for (const item of items) {
    const decoded = decode(input.decoder, item);
    if (!decoded.ok) total.invalid += 1;
    else if (input.record({ ...decoded.value, at: decoded.value.at ?? input.at })) total.recorded += 1;
    else total.skipped += 1;
  }
  return total;
}

/** The storage behind the notes service: one catalogue-file transaction per call. */
export class EffectNotesStore implements EffectNotesPersistence {
  constructor(private readonly runner: NotesRunner) {}

  read(input: JsonValue): NotesReadResponse | NoteFailure {
    return this.runner.run("read", (database) => readEffectNotes(database, input));
  }

  write(note: JsonValue, at: number): NotesResult<NoteWritten> {
    return this.runner.run("write", (database) => withRequest(noteWriteRequest, note, (request) => writeEffectNote(database, { request, kind: "agent-inferred", at })));
  }

  recordMeasuredNote(note: JsonValue, at: number): NotesResult<NoteWritten> {
    return this.runner.run("write", (database) => withRequest(noteWriteRequest, note, (request) => writeEffectNote(database, { request, kind: "measured", at })));
  }

  audit(input: JsonValue): NotesResult<{ notes: HistoryNoteView[] }> {
    return this.runner.run("read", (database) => withRequest(auditRequest, input, (request) => auditNotes(database, request)));
  }

  restore(input: JsonValue, at: number): NotesResult<NotesReadResponse & { restored: NoteView }> {
    return this.runner.run("write", (database) => withRequest(restoreRequest, input, (request) => restoreNote(database, { request, at })));
  }

  forget(scope: JsonValue): NotesResult<{ removed: number }> {
    return this.runner.run("write", (database) => withRequest(forgetRequest, scope, (request) => forgetNotes(database, request)));
  }

  setPluginOptIn(input: JsonValue, at: number): NotesResult<{ pluginKey: string; enabled: boolean }> {
    return this.runner.run("write", (database) => withRequest(optInRequest, input, (request) => setPluginOptIn(database, { request, at })));
  }

  optIns(): NotesResult<OptInView> {
    return this.runner.run("read", (database) => ok(optInView(database)));
  }

  recordKeptUsage(input: KeptUsageInput | readonly KeptUsageInput[], at: number): NotesResult<UsageRecorded> {
    return this.runner.run("write", (database) => ok(applyUsage(many(input), { decoder: keptUsageRecord, at, record: (record) => recordKeptUsage(database, record) })));
  }

  recordSeenUsage(input: SeenUsageInput | readonly SeenUsageInput[], at: number): NotesResult<UsageRecorded> {
    return this.runner.run("write", (database) => ok(applyUsage(many(input), { decoder: seenUsageRecord, at, record: (record) => recordSeenUsage(database, record) })));
  }

  recordKeptEvents(input: KeptEventInput | readonly KeptEventInput[], at: number): NotesResult<UsageRecorded> {
    return this.runner.run("write", (database) => {
      const done = applyUsage(many(input), { decoder: keptEventRecord, at, record: (record) => recordKeptEvent(database, record) });
      trimEvents(database);
      return ok(done);
    });
  }

  recordSeenEvents(input: SeenEventInput | readonly SeenEventInput[], at: number): NotesResult<UsageRecorded> {
    return this.runner.run("write", (database) => {
      const done = applyUsage(many(input), { decoder: seenEventRecord, at, record: (record) => recordSeenEvent(database, record) });
      trimEvents(database);
      return ok(done);
    });
  }

  recordHabitSamples(input: HabitSampleInput | readonly HabitSampleInput[], at: number): NotesResult<UsageRecorded> {
    return this.runner.run("write", (database) => {
      const done = applyUsage(many(input), { decoder: habitSampleRecord, at, record: (record) => recordHabitSample(database, record) });
      trimHabitSamples(database);
      return ok(done);
    });
  }

  animationHabits(): NotesResult<{ habits: AnimationHabits | null }> {
    return this.runner.run("read", (database) => ok({ habits: readHabits(database) }));
  }

  learned(): NotesResult<{ learned: LearnedSummary }> {
    return this.runner.run("read", (database) => ok({ learned: learnedSummary(database) }));
  }

  rankedUsage(input: { kind: UsageKind; limit: number }): NotesResult<{ ranked: UsageRank[] }> {
    return this.runner.run("read", (database) => ok({ ranked: rankedUsage(database, input) }));
  }

  unrecordPlanUsage(planId: string, at: number): NotesResult<{ removed: number }> {
    return this.runner.run("write", (database) => {
      try {
        return ok({ removed: unrecordPlanUsage(database, { planId, at }) + removeHabitSamples(database, planId) });
      } catch (error) {
        if (error instanceof EffectNotesError) return noteFailure(error);
        throw error;
      }
    });
  }

  forgetUsage(): NotesResult<{ removed: number }> {
    return this.runner.run("write", (database) => ok({ removed: forgetAllUsage(database) + removeHabitSamples(database) }));
  }
}

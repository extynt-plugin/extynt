/** Tests usage statistics for kept control values: counts, bounds, median and the latest values. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import type { KeptUsageInput, NoteValue, SeenUsageInput } from '../apps/sidecar/dist/src/effect-notes-types.js';
import { parseJson, flagOf } from '../apps/sidecar/dist/tests/http-json.js';
import { codeOf, controlPath, notesHarness, present, readNotes, succeeded, uncheckedRecorder, withCaps, writeNote } from './effect-notes-support.ts';
import type { NotesHarness, UncheckedKeptUsage } from './effect-notes-support.ts';

const GLOW = 'ADBE Glo2', AMOUNT = controlPath(GLOW, 1), RADIUS = controlPath(GLOW, 2);
const kept = (planId: string, value: NoteValue, extra: Partial<KeptUsageInput> = {}): KeptUsageInput =>
  ({ planId, matchName: GLOW, controlPath: AMOUNT, value, ...extra });
const looseKept = (planId: string, value: NoteValue | string): UncheckedKeptUsage =>
  ({ planId, matchName: GLOW, controlPath: AMOUNT, value });
const stats = (harness: NotesHarness, path = AMOUNT) => present(readNotes(harness, GLOW, path).usage.find(entry => entry.controlPath === path));
const keptStats = (harness: NotesHarness, path = AMOUNT) => present(stats(harness, path).kept);
const seenStats = (harness: NotesHarness) => present(stats(harness).seen);

test('kept values are recorded once per plan and computed into count, min, max, median and the last three', t => {
  const harness = notesHarness(t);
  for (const [plan, value] of [['p1', 10], ['p2', 30], ['p3', 20], ['p4', 40]] as const) assert.equal(succeeded(harness.service.recordKeptUsage(kept(plan, value))).recorded, 1);
  harness.service.recordKeptUsage(kept('p4', 40));
  const usage = keptStats(harness);
  assert.deepEqual([usage.count, usage.min, usage.max, usage.median, usage.recent], [4, 10, 40, 25, [30, 20, 40]], 'a replayed record changes nothing');
  assert.equal(stats(harness).seen, null);
});

test('a plan records a control once per slot, and the replay updates rather than adds', t => {
  const harness = notesHarness(t);
  harness.service.recordKeptUsage([kept('p1', 10, { slot: 'layer-a' }), kept('p1', 12, { slot: 'layer-b' }), kept('p1', 11, { slot: 'layer-a' })]);
  const usage = keptStats(harness);
  assert.deepEqual([usage.count, usage.min, usage.max], [2, 11, 12]);
});

test('undoing a plan removes its contribution, so only kept values remain, and a late record for it is ignored', t => {
  const harness = notesHarness(t);
  harness.service.recordKeptUsage([kept('keep', 10), kept('undo', 90, { slot: 'a' }), kept('undo', 80, { slot: 'b' })]);
  assert.equal(keptStats(harness).count, 3);
  assert.equal(succeeded(harness.service.unrecordPlanUsage('undo')).removed, 2);
  const usage = keptStats(harness);
  assert.deepEqual([usage.count, usage.max], [1, 10]);
  assert.equal(succeeded(harness.service.recordKeptUsage(kept('undo', 95))).skipped, 1, 'an undone plan cannot be recorded again');
  assert.equal(keptStats(harness).count, 1);
  assert.equal(succeeded(harness.service.unrecordPlanUsage('never-recorded')).removed, 0);
  assert.equal(succeeded(harness.service.recordKeptUsage(kept('never-recorded', 5))).skipped, 1, 'undo that arrives first still wins');
});

test('seen values are deduplicated by where they were seen, so a re-read never double-counts', t => {
  const harness = notesHarness(t), seen = (key: string, value: number): SeenUsageInput => ({ matchName: GLOW, controlPath: AMOUNT, key, value });
  harness.service.recordSeenUsage([seen('proj/comp/layer1/glow/amount', 20), seen('proj/comp/layer2/glow/amount', 60)]);
  harness.service.recordSeenUsage([seen('proj/comp/layer1/glow/amount', 20), seen('proj/comp/layer2/glow/amount', 70)]);
  const usage = seenStats(harness);
  assert.deepEqual([usage.count, usage.min, usage.max, usage.median], [2, 20, 70, 45]);
  assert.equal(stats(harness).kept, null);
});

test('rows are bounded at 64 per control per source, oldest evicted, and sources are bounded separately', t => {
  const harness = notesHarness(t);
  harness.service.recordKeptUsage(Array.from({ length: 70 }, (_, index) => kept(`plan-${index}`, index + 1, { at: 100 + index })));
  harness.service.recordSeenUsage(Array.from({ length: 66 }, (_, index) => ({ matchName: GLOW, controlPath: AMOUNT, key: `k${index}`, value: 1000 + index, at: 100 + index })));
  const usage = keptStats(harness), seenUsage = seenStats(harness);
  assert.deepEqual([usage.count, usage.min, usage.max], [64, 7, 70]);
  assert.deepEqual([seenUsage.count, seenUsage.min, seenUsage.max], [64, 1002, 1065]);
  harness.service.recordKeptUsage(kept('other-control', 5, { controlPath: RADIUS }));
  assert.equal(keptStats(harness, RADIUS).count, 1, 'another control keeps its own budget');
});

test('vector values are shown but never enter the numeric stats; malformed values are counted, not recorded', t => {
  const harness = notesHarness(t);
  const result = succeeded(uncheckedRecorder(harness.service).recordKeptUsage([looseKept('v1', [960, 540]), looseKept('v2', 7), looseKept('v3', 'seven'), looseKept('v4', [1]), looseKept('', 3)]));
  assert.deepEqual([result.recorded, result.invalid], [2, 3]);
  const usage = keptStats(harness);
  assert.deepEqual([usage.count, usage.vectorCount, usage.min, usage.max, usage.recent], [1, 1, 7, 7, [[960, 540], 7]]);
});

test('usage statistics never count toward a note cap', t => {
  withCaps(t, { effect: '1', control: '1' });
  const harness = notesHarness(t); harness.optIn();
  harness.service.recordKeptUsage(Array.from({ length: 10 }, (_, index) => kept(`p${index}`, index)));
  assert.equal(writeNote(harness, GLOW, { text: 'only note', controlPath: AMOUNT }).ok, true);
  assert.equal(codeOf(writeNote(harness, GLOW, { text: 'second', controlPath: AMOUNT })), 'EFFECT_NOTES_CAP_REACHED');
  assert.equal(keptStats(harness).count, 10);
});

test('forget usage clears every row and the plan index; notes are untouched', t => {
  const harness = notesHarness(t); harness.optIn();
  writeNote(harness, GLOW, { text: 'a note' });
  harness.service.recordKeptUsage(kept('p1', 10)); harness.service.recordSeenUsage({ matchName: GLOW, controlPath: AMOUNT, key: 'k', value: 3 });
  harness.service.unrecordPlanUsage('p2');
  assert.equal(succeeded(harness.service.forgetUsage()).removed, 2);
  const read = readNotes(harness, GLOW);
  assert.deepEqual(read.usage, []); assert.equal(read.notes.length, 1);
  assert.equal(succeeded(harness.service.recordKeptUsage(kept('p2', 4))).recorded, 1, 'the plan index went with it');
});

test('"Learn from my work" off records nothing, still lets undo remove, persists across restarts, and defaults on', t => {
  const harness = notesHarness(t);
  assert.equal(harness.service.learnFromWork(), true); assert.equal(succeeded(harness.service.settingsView()).learnFromWork, true);
  harness.service.recordKeptUsage(kept('p1', 10));
  assert.deepEqual(harness.service.setLearnFromWork(false), { ok: true, learnFromWork: false, writeAuthorizing: false });
  const skipped = succeeded(harness.service.recordKeptUsage([kept('p2', 20), kept('p3', 30)])), seen = succeeded(harness.service.recordSeenUsage({ matchName: GLOW, controlPath: AMOUNT, key: 'k', value: 1 }));
  assert.deepEqual([skipped.recorded, skipped.skipped, seen.recorded, seen.skipped], [0, 2, 0, 1]);
  assert.equal(keptStats(harness).count, 1, 'existing rows stay until Forget'); assert.equal(stats(harness).seen, null);
  assert.equal(succeeded(harness.service.unrecordPlanUsage('p1')).removed, 1, 'removing is always allowed');
  harness.restart();
  assert.equal(harness.service.learnFromWork(), false); assert.equal(succeeded(harness.service.settingsView()).learnFromWork, false);
  assert.equal(flagOf(parseJson(readFileSync(join(harness.directory, 'effect-notes-settings.json'), 'utf8')), 'learnFromWork'), false);
  harness.service.setLearnFromWork(true);
  assert.equal(succeeded(harness.service.recordKeptUsage(kept('p4', 40))).recorded, 1);
});

test('a missing or damaged settings file means the default: learning on', t => {
  const harness = notesHarness(t), file = join(harness.directory, 'effect-notes-settings.json');
  assert.equal(existsSync(file), false); assert.equal(harness.service.learnFromWork(), true);
  harness.service.setLearnFromWork(false);
  writeFileSync(file, '{ not json');
  harness.restart();
  assert.equal(harness.service.learnFromWork(), true);
  writeFileSync(file, JSON.stringify({ learnFromWork: 'no' }));
  harness.restart();
  assert.equal(harness.service.learnFromWork(), true);
});

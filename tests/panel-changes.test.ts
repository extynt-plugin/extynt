/** Tests how the panel reads the sidecar's change answer into labels and tones. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { decode } from '../packages/decode/dist/src/index.js';
import { undoRequestedLine, ageText, changeRows, changesDecoder, undoFailureLine } from '../apps/panel/dist/runtime/panel-changes.js';
import type { ChangeRow, ChangesAnswer } from '../apps/panel/dist/runtime/panel-changes.js';
import { chipFor } from '../apps/panel/dist/runtime/panel-plan-labels.js';
import type { JsonObject, JsonValue } from '../packages/decode/dist/src/index.js';

type WireInput = JsonValue | undefined;

const NOW = Date.parse('2026-10-03T12:00:00.000Z');
const change = (planId: string, extra: JsonObject = {}): JsonObject => ({ planId, summary: `Change ${planId}`, appliedAt: '2026-10-03T11:55:00.000Z', operations: 3, files: [], status: 'verified', undoGroupsRemaining: 1, undo: { available: true }, ...extra });
const readChanges = (value: WireInput): ChangesAnswer | null => {
  const result = decode(changesDecoder, value);
  return result.ok ? result.value : null;
};

function answerOf(value: WireInput): ChangesAnswer {
  const view = readChanges(value);
  if (view === null) throw new Error('the changes answer was not read');
  return view;
}

function changeAt(view: ChangesAnswer, index: number): ChangesAnswer['changes'][number] {
  const found = view.changes[index];
  if (found === undefined) throw new Error(`no change ${index}`);
  return found;
}

function rowAt(rows: readonly ChangeRow[], index: number): ChangeRow {
  const found = rows[index];
  if (found === undefined) throw new Error(`no row ${index}`);
  return found;
}

const statusLabel = (status: string, mayHaveMutated: boolean): string => chipFor(status, mayHaveMutated).label;
const statusTone = (status: string, mayHaveMutated: boolean): string => chipFor(status, mayHaveMutated).tone;
const undoNote = (entry: JsonObject): string => rowAt(changeRows(answerOf({ ok: true, project: null, changes: [{ planId: 'u', ...entry }], truncated: false }), NOW), 0).undoNote;
const answer = (extra: JsonObject = {}): JsonObject => ({ ok: true, project: { name: 'Titles.aep', filePath: null }, changes: [change('a')], truncated: false, writeAuthorizing: false, ...extra });

test('the answer is read only when it is the sidecar\'s list, and bad rows are dropped', () => {
  const view = answerOf(answer({ changes: [change('a'), null, 'x', { summary: 'no id' }, change('b', { undo: { available: false, code: 'UNDO_NOT_LATEST', reason: 'newer on top' } })] }));
  assert.deepEqual(view.changes.map((entry) => entry.planId), ['a', 'b']);
  assert.equal(view.project, 'Titles.aep');
  assert.deepEqual(changeAt(view, 1).undo, { available: false, code: 'UNDO_NOT_LATEST', reason: 'newer on top' });
  assert.equal(answerOf(answer({ project: null })).project, null);
  const unreadable: readonly WireInput[] = [null, 'x', [], {}, { ok: true }, { ok: false, changes: [] }, { ok: true, changes: 'no' }];
  for (const bad of unreadable) assert.equal(readChanges(bad), null, JSON.stringify(bad));
  assert.deepEqual(changeAt(answerOf(answer({ changes: [change('a', { operations: -2, undoGroupsRemaining: 'x', undo: 'yes' })] })), 0), { planId: 'a', summary: 'Change a', appliedAt: '2026-10-03T11:55:00.000Z', operations: 0, files: [], status: 'verified', mayHaveMutated: false, undoGroupsRemaining: 0, undo: { available: false, code: '', reason: '' }, source: 'panel', jobId: null, batch: null, origin: null }, 'an undo state that is not "available: true" is never read as available');
});

test('every status has a plain label and a tone, and an unknown status is not an alarm', () => {
  const labels: Readonly<Record<string, string>> = { verified: 'Done', applied: 'Done', applied_unverified: 'Done · not all checked', partially_undone: 'Partly undone', undone: 'Undone', undo_requested: 'Undoing', undo_unverified: 'Undo not confirmed', failed: "Didn't apply" };
  for (const [status, label] of Object.entries(labels)) assert.equal(statusLabel(status, false), label);
  assert.equal(statusLabel('something_new', false), 'Done');
  assert.deepEqual(['verified', 'applied_unverified', 'failed', 'undone', 'something_new'].map((status) => statusTone(status, false)), ['ok', 'warn', 'bad', '', 'ok']);
  assert.equal(statusLabel('failed', true), 'Partly applied', 'a failure that may have reached After Effects does not claim nothing changed');
  assert.equal(changeAt(answerOf(answer({ changes: [change('m', { status: 'failed', mayHaveMutated: true })] })), 0).mayHaveMutated, true);
});

test('age reads like a person would say it, and an unreadable time says nothing', () => {
  const ago = (seconds: number): string => ageText(new Date(NOW - seconds * 1000).toISOString(), NOW);
  assert.deepEqual([10, 44, 60, 300, 3599, 3600, 7200, 86399, 86400, 3 * 86400].map(ago), ['just now', 'just now', '1 min ago', '5 min ago', '60 min ago', '1 h ago', '2 h ago', '24 h ago', '1 d ago', '3 d ago']);
  assert.equal(ageText('not a time', NOW), '');
  assert.equal(ageText(new Date(NOW + 5000).toISOString(), NOW), 'just now', 'a clock a little ahead is not negative');
});

test('a change that cannot be undone says why: "Can no longer undo" when it once could, something else when it never could', () => {
  const blocked = (code: string, reason: string): JsonObject => ({ planId: 'a', undo: { available: false, code, reason } });
  assert.equal(undoNote({ undo: { available: true } }), '');
  assert.equal(undoNote(blocked('UNDO_PROJECT_CHANGED', 'the project changed after this was applied')), 'Can no longer undo: the project changed after this was applied.');
  assert.equal(undoNote(blocked('UNDO_NOT_LATEST', 'a newer change was made on top of this one; undo that one first.')), 'Can no longer undo: a newer change was made on top of this one; undo that one first.');
  assert.equal(undoNote(blocked('ALREADY_UNDONE', 'already undone')), 'Nothing left to undo.');
  assert.equal(undoNote(blocked('NOTHING_CHANGED', 'nothing was changed')), 'Nothing was changed, so there is nothing to undo.');
  assert.equal(undoNote(blocked('X', '')), 'May no longer be undoable.', 'no reason given is said honestly');
});

test('each row carries what to draw and nothing a user would not say', () => {
  const view = answerOf(answer({ changes: [change('a', { undoGroupsRemaining: 3 }), change('b', { operations: 1, status: 'undone', undoGroupsRemaining: 0, undo: { available: false, code: 'ALREADY_UNDONE', reason: 'already undone' } })] }));
  const rows = changeRows(view, NOW), first = rowAt(rows, 0), second = rowAt(rows, 1);
  const drawn = (row: ChangeRow) => ({
    planId: row.planId, title: row.title, status: row.status, statusLabel: row.statusLabel, tone: row.tone, meta: row.meta,
    canUndo: row.canUndo, undoNote: row.undoNote, undoTitle: row.undoTitle,
  });
  assert.deepEqual(drawn({ ...first, undoTitle: '' }), { planId: 'a', title: 'Change a', status: 'verified', statusLabel: 'Done', tone: 'ok', meta: '5 min ago · 3 ops · 3 undo steps left', canUndo: true, undoNote: '', undoTitle: '' });
  assert.match(first.undoTitle, /^Undo all 3 steps of this change/);
  assert.deepEqual(drawn(second), { planId: 'b', title: 'Change b', status: 'undone', statusLabel: 'Undone', tone: '', meta: '5 min ago · 1 op', canUndo: false, undoNote: 'Nothing left to undo.', undoTitle: '' });
  assert.equal(first.filesLine, '', 'a change that wrote no file outside the project says nothing about files');
  assert.equal(rowAt(changeRows({ project: 'P', truncated: false, changes: [{ ...changeAt(answerOf(answer({ changes: [change('c')] })), 0), files: ['C:\\out\\a.mov', '/tmp/b.png'] }] }, NOW), 0).filesLine, 'Wrote 2 files outside the project: a.mov, b.png.');
  assert.equal(rowAt(changeRows({ project: 'P', truncated: false, changes: [{ ...changeAt(answerOf(answer({ changes: [change('c')] })), 0), summary: '' }] }, NOW), 0).title, 'c', 'a change with no summary is named by its id rather than left blank');
});

test('a failed undo says what the sidecar said, with a plain fallback, and the success line is fixed', () => {
  assert.equal(undoFailureLine('The project changed after this plan was applied; nothing was undone.'), 'Could not undo: The project changed after this plan was applied; nothing was undone.');
  assert.equal(undoFailureLine(null), 'Could not undo: it was not accepted.');
  assert.equal(undoFailureLine(''), 'Could not undo: it was not accepted.');
  assert.equal(undoRequestedLine(), 'Undo requested. After Effects is restoring the project.');
});

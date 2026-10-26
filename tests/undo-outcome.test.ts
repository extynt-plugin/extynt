/** Tests how undo outcomes read: panel refusals, sidecar claim refusals and unknown results. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeOrThrow } from '../packages/decode/dist/src/index.js';
import { undoDataDecoder, undoOutcome as outcomeOf } from '../apps/panel/dist/runtime/undo-outcome.js';
import type { UndoOutcome } from '../apps/panel/dist/runtime/undo-outcome.js';
import type { JsonObject } from '../apps/sidecar/dist/tests/http-json.js';

interface UndoAnswer {
  readonly ok: true;
  readonly data: JsonObject;
}

const undoOutcome = (answer: UndoAnswer): UndoOutcome => outcomeOf(decodeOrThrow(undoDataDecoder, answer.data));
const problemOf = (answer: UndoAnswer): string => undoOutcome(answer).problem ?? '';

test('a refusal from the panel check is a problem, not "Undo requested"', () => {
  const outcome = undoOutcome({ ok: true, data: { status: 'verified', receipt: { status: 'rejected', hostError: { code: 'UNDO_PROJECT_CHANGED', message: 'After Effects recorded changes.' } } } });
  assert.equal(outcome.problem, 'Not undone: After Effects recorded changes.');
  assert.equal(outcome.status, null);
});

test('a sidecar claim refusal reads its error field', () => {
  assert.match(problemOf({ ok: true, data: { status: 'verified', receipt: { status: 'rejected', error: { message: 'The project changed before the panel could undo.' } } } }), /^Not undone: The project changed/);
});

test('a workflow refusal with nothing queued is a problem', () => {
  assert.match(problemOf({ ok: true, data: { status: 'verified', workflowRefused: true } }), /^Not undone/);
});

test('done, still queued and unverified each say so', () => {
  assert.deepEqual(undoOutcome({ ok: true, data: { status: 'undone', receipt: { status: 'executed' } } }), { problem: null, text: 'Undone.', status: 'undone' });
  assert.equal(undoOutcome({ ok: true, data: { status: 'undo_requested', note: 'Undo still queued.' } }).status, 'undo_requested');
  assert.match(problemOf({ ok: true, data: { status: 'undo_unverified', receipt: { status: 'executed' } } }), /does not match/);
  assert.match(problemOf({ ok: true, data: { status: 'verified', receipt: { status: 'unknown', hostError: { message: 'timed out' } } } }), /unknown: timed out/);
});

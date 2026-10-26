/** Tests effect-note caps and read shape: observed facts first, separate from notes, no write authority. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { effectNoteCaps } from '../apps/sidecar/dist/src/effect-notes-types.js';
import type { NoteFields } from './effect-notes-support.ts';
import { codeOf, controlPath, currentOf, notesHarness, present, readNotes, refusal, succeeded, withCaps, writeNote } from './effect-notes-support.ts';

const GLOW = 'ADBE Glo2', AMOUNT = controlPath(GLOW, 1), RADIUS = controlPath(GLOW, 2), GAIN = controlPath(GLOW, 3);

test('caps default to 5 per effect and 2 per control, and the environment tunes them within 1..20', t => {
  withCaps(t, {});
  assert.deepEqual(effectNoteCaps(), { perEffect: 5, perControl: 2 });
  assert.deepEqual(effectNoteCaps({ EXTYNT_NOTES_PER_EFFECT: '9', EXTYNT_NOTES_PER_CONTROL: '3' }), { perEffect: 9, perControl: 3 });
  assert.deepEqual(effectNoteCaps({ EXTYNT_NOTES_PER_EFFECT: '0', EXTYNT_NOTES_PER_CONTROL: '21' }), { perEffect: 5, perControl: 2 }, 'out of range keeps the default');
  assert.deepEqual(effectNoteCaps({ EXTYNT_NOTES_PER_EFFECT: 'many', EXTYNT_NOTES_PER_CONTROL: '2.5' }), { perEffect: 5, perControl: 2 });
  withCaps(t, { effect: '7', control: '4' });
  assert.deepEqual(readNotes(notesHarness(t), GLOW).caps, { perEffect: 7, perControl: 4 });
});

test('a read puts observed facts first, separate from notes, and authorizes no write', t => {
  const harness = notesHarness(t), read = readNotes(harness, GLOW);
  assert.equal(read.ok, true); assert.equal(read.writeAuthorizing, false);
  assert.equal(read.effect.pluginKey, 'Synthetic'); assert.equal(read.host.aeBuild, '26.2');
  assert.equal(read.observed.trust, 'fact'); assert.equal(read.observed.probed, true);
  const amount = present(read.observed.controls.find(control => control.controlPath === AMOUNT));
  assert.deepEqual([amount.name, amount.valueType, amount.minimum, amount.maximum, amount.defaultValue, amount.group], ['Amount', 'OneD', 0, 100, 12, false]);
  assert.equal(read.observed.controls.some(control => control.group), true, 'group rows are labelled as groups');
  assert.deepEqual(read.notes, []); assert.deepEqual(read.noteIds, []); assert.deepEqual(read.usage, []); assert.equal(read.documentationEnabled, false);
  assert.deepEqual(readNotes(harness, GLOW, RADIUS).observed.controls.map(control => control.controlPath), [RADIUS]);
});

test('an effect the current host does not list is refused, and a never-probed effect reads as not probed', t => {
  const harness = notesHarness(t, { names: [GLOW, 'ADBE Blur'] });
  assert.equal(codeOf(harness.service.read({ matchName: 'Vendor Missing' })), 'EFFECT_NOTES_UNKNOWN_EFFECT');
  assert.equal(codeOf(harness.service.read({ matchName: 7 })), 'EFFECT_NOTES_INVALID');
  const fresh = notesHarness(t, { names: ['ADBE Blur'], probe: false });
  assert.equal(readNotes(fresh, 'ADBE Blur').observed.probed, false);
});

test('an agent-inferred note needs the plugin opted in, and is written as a labelled guess', t => {
  const harness = notesHarness(t);
  const refused = refusal(writeNote(harness, GLOW, { text: 'Amount scales the glow radius.', controlPath: AMOUNT }));
  assert.equal(refused.ok, false); assert.equal(refused.code, 'EFFECT_NOTES_DOCUMENTATION_OFF'); assert.equal(refused.writeAuthorizing, false);
  assert.equal(readNotes(harness, GLOW).notes.length, 0);
  assert.equal(harness.optIn().ok, true);
  const written = succeeded(writeNote(harness, GLOW, { text: 'Amount\nscales   the glow radius.', controlPath: AMOUNT, value: 40 }));
  assert.equal(written.ok, true); assert.equal(written.writeAuthorizing, false);
  assert.deepEqual([written.written.kind, written.written.trust, written.written.text, written.written.value, written.written.controlPath, written.written.stale], ['agent-inferred', 'labelled-guess', 'Amount scales the glow radius.', 40, AMOUNT, false]);
  assert.deepEqual(written.noteIds, [written.written.id]); assert.equal(written.documentationEnabled, true);
});

test('observed facts are returned unchanged by any note: a note carries no type, range or default of its own', t => {
  const harness = notesHarness(t); harness.optIn();
  const before = readNotes(harness, GLOW).observed;
  writeNote(harness, GLOW, { text: 'Actually goes to 500 and defaults to 99.', controlPath: AMOUNT, value: [1, 2] });
  assert.deepEqual(readNotes(harness, GLOW).observed, before);
});

test('read-before-write: a stale expectedNoteIds set is rejected with the current notes, and the retry succeeds', t => {
  const harness = notesHarness(t); harness.optIn();
  const first = succeeded(writeNote(harness, GLOW, { text: 'First reading.', controlPath: AMOUNT }));
  const stale = refusal(harness.service.write({ matchName: GLOW, text: 'Second reading.', controlPath: AMOUNT, expectedNoteIds: [] }));
  assert.equal(stale.ok, false); assert.equal(stale.code, 'EFFECT_NOTES_STALE');
  const staleCurrent = currentOf(stale);
  assert.deepEqual(staleCurrent.noteIds, [first.written.id]); assert.equal(staleCurrent.notes[0]?.text, 'First reading.'); assert.equal(staleCurrent.writeAuthorizing, false);
  assert.equal(codeOf(harness.service.write({ matchName: GLOW, text: 'Bogus.', expectedNoteIds: [first.written.id, 'ghost'] })), 'EFFECT_NOTES_STALE', 'an extra id is a different set');
  assert.equal(codeOf(harness.service.write({ matchName: GLOW, text: 'No set at all.' })), 'EFFECT_NOTES_INVALID', 'the set is required');
  const retry = succeeded(harness.service.write({ matchName: GLOW, text: 'Second reading.', controlPath: AMOUNT, expectedNoteIds: staleCurrent.noteIds }));
  assert.equal(retry.ok, true); assert.equal(retry.notes.length, 2);
  const reordered = harness.service.write({ matchName: GLOW, text: 'Effect-wide.', expectedNoteIds: [...retry.noteIds].reverse() });
  assert.equal(reordered.ok, true, 'the comparison ignores order');
});

test('a control holds 2 notes: the third is refused with the current notes unless it replaces one with a reason', t => {
  const harness = notesHarness(t); harness.optIn();
  writeNote(harness, GLOW, { text: 'One.', controlPath: AMOUNT }); writeNote(harness, GLOW, { text: 'Two.', controlPath: AMOUNT });
  const capped = refusal(writeNote(harness, GLOW, { text: 'Three.', controlPath: AMOUNT }));
  const cappedCurrent = currentOf(capped), replaced = cappedCurrent.noteIds[0];
  assert.equal(capped.code, 'EFFECT_NOTES_CAP_REACHED'); assert.equal(capped.cap, 'control'); assert.equal(cappedCurrent.notes.length, 2);
  assert.equal(codeOf(writeNote(harness, GLOW, { text: 'Three.', controlPath: AMOUNT, replaces: replaced })), 'EFFECT_NOTES_INVALID', 'replaces needs a reason');
  assert.equal(codeOf(writeNote(harness, GLOW, { text: 'Three.', controlPath: AMOUNT, reason: 'because' })), 'EFFECT_NOTES_INVALID', 'a reason needs replaces');
  const swapped = succeeded(writeNote(harness, GLOW, { text: 'Three.', controlPath: AMOUNT, replaces: replaced, reason: 'Measured more carefully.' }));
  assert.equal(swapped.ok, true); assert.equal(swapped.replaced, replaced); assert.equal(swapped.notes.length, 2);
  assert.equal(swapped.noteIds.includes(present(replaced)), false, 'the replaced note is no longer returned to the agent');
  const history = succeeded(harness.service.audit({ matchName: GLOW })).notes;
  assert.deepEqual(history.map(note => [note.id, note.state, note.replacedBy, note.replaceReason]), [[replaced, 'replaced', swapped.written.id, 'Measured more carefully.']]);
});

test('an effect holds 5 notes across its controls; at the limit any current note may be replaced', t => {
  const harness = notesHarness(t); harness.optIn();
  for (const [text, path] of [['a', AMOUNT], ['b', AMOUNT], ['c', RADIUS], ['d', RADIUS], ['e', null]] as const) writeNote(harness, GLOW, { text, controlPath: path });
  const capped = refusal(writeNote(harness, GLOW, { text: 'f', controlPath: GAIN }));
  assert.equal(capped.code, 'EFFECT_NOTES_CAP_REACHED'); assert.equal(capped.cap, 'effect'); assert.equal(currentOf(capped).notes.length, 5);
  const radiusNote = present(currentOf(capped).notes.find(note => note.controlPath === RADIUS));
  const swapped = succeeded(writeNote(harness, GLOW, { text: 'f', controlPath: GAIN, replaces: radiusNote.id, reason: 'Gain matters more.' }));
  assert.equal(swapped.ok, true); assert.equal(swapped.notes.length, 5);
  assert.equal(codeOf(writeNote(harness, GLOW, { text: 'g', controlPath: GAIN, replaces: radiusNote.id, reason: 'again' })), 'EFFECT_NOTES_REPLACE_INVALID', 'a replaced note is no longer current');
});

test('replace scope: control overflow stays on the control, a correction stays on its control, an agent never displaces measured evidence', t => {
  const harness = notesHarness(t); harness.optIn();
  writeNote(harness, GLOW, { text: 'a', controlPath: AMOUNT }); writeNote(harness, GLOW, { text: 'b', controlPath: AMOUNT }); writeNote(harness, GLOW, { text: 'c', controlPath: RADIUS });
  const read = readNotes(harness, GLOW);
  const amountId = present(read.notes.find(note => note.controlPath === AMOUNT)).id;
  const radiusId = present(read.notes.find(note => note.controlPath === RADIUS)).id;
  assert.equal(codeOf(writeNote(harness, GLOW, { text: 'x', controlPath: AMOUNT, replaces: radiusId, reason: 'wrong control' })), 'EFFECT_NOTES_REPLACE_INVALID', 'control overflow needs a note on the same control');
  assert.equal(codeOf(writeNote(harness, GLOW, { text: 'x', controlPath: GAIN, replaces: radiusId, reason: 'under the cap' })), 'EFFECT_NOTES_REPLACE_INVALID', 'a correction below the cap stays on its control');
  assert.equal(codeOf(writeNote(harness, GLOW, { text: 'x', controlPath: AMOUNT, replaces: 'no-such-note', reason: 'ghost' })), 'EFFECT_NOTES_REPLACE_INVALID');
  const correction = succeeded(writeNote(harness, GLOW, { text: 'c, corrected', controlPath: RADIUS, replaces: radiusId, reason: 'Corrected wording.' }));
  assert.equal(correction.ok, true);
  const measured = succeeded(harness.service.recordMeasuredNote({ matchName: GLOW, controlPath: RADIUS, text: 'Measured: 40 covers 30% of the frame.', value: 40, expectedNoteIds: correction.noteIds }));
  assert.equal(measured.ok, true);
  assert.equal(codeOf(writeNote(harness, GLOW, { text: 'z', controlPath: RADIUS, replaces: measured.written.id, reason: 'I know better.' })), 'EFFECT_NOTES_REPLACE_INVALID', 'measured stays evidence');
  assert.equal(amountId.length > 0, true);
});

test('invalid notes are refused: length, value, unknown or group control, and a control with no observed definition', t => {
  const harness = notesHarness(t); harness.optIn();
  const code = (fields: NoteFields): string | undefined => codeOf(writeNote(harness, GLOW, fields));
  assert.equal(code({ text: '' }), 'EFFECT_NOTES_INVALID'); assert.equal(code({ text: 'x'.repeat(281) }), 'EFFECT_NOTES_INVALID'); assert.equal(code({ text: 5 }), 'EFFECT_NOTES_INVALID');
  assert.equal(code({ text: 'ok', value: 'forty' }), 'EFFECT_NOTES_INVALID'); assert.equal(code({ text: 'ok', value: [1] }), 'EFFECT_NOTES_INVALID'); assert.equal(code({ text: 'ok', value: [1, 2, 3, 4, 5] }), 'EFFECT_NOTES_INVALID');
  assert.equal(code({ text: 'ok', controlPath: 'No Such Control' }), 'EFFECT_NOTES_INVALID'); assert.equal(code({ text: 'ok', controlPath: `${GLOW}-Group` }), 'EFFECT_NOTES_INVALID', 'a group has no value');
  assert.equal(writeNote(harness, GLOW, { text: 'x'.repeat(280) }).ok, true, '280 characters is the limit');
  const fresh = notesHarness(t, { names: ['ADBE Blur'], probe: false }); fresh.optIn();
  assert.equal(codeOf(writeNote(fresh, 'ADBE Blur', { text: 'ok', controlPath: 'ADBE Blur-0001' })), 'EFFECT_NOTES_INVALID', 'only an effect-level note before the controls are learned');
  assert.equal(writeNote(fresh, 'ADBE Blur', { text: 'ok' }).ok, true);
});

test('measured notes arrive only through the internal door: same rules, no opt-in, evidence trust', t => {
  const harness = notesHarness(t);
  const measured = succeeded(harness.service.recordMeasuredNote({ matchName: GLOW, controlPath: AMOUNT, text: 'At 40 the glow covers about 30% of the frame.', value: 40, expectedNoteIds: [] }));
  assert.equal(measured.ok, true); assert.deepEqual([measured.written.kind, measured.written.trust], ['measured', 'evidence']);
  assert.equal(codeOf(harness.service.recordMeasuredNote({ matchName: GLOW, text: 'stale', expectedNoteIds: [] })), 'EFFECT_NOTES_STALE', 'same read-before-write rule');
  harness.service.recordMeasuredNote({ matchName: GLOW, controlPath: AMOUNT, text: 'second', expectedNoteIds: measured.noteIds });
  const third = harness.service.recordMeasuredNote({ matchName: GLOW, controlPath: AMOUNT, text: 'third', expectedNoteIds: readNotes(harness, GLOW).noteIds });
  assert.equal(codeOf(third), 'EFFECT_NOTES_CAP_REACHED', 'same caps');
});

test('every notes response says it authorizes no write', t => {
  const harness = notesHarness(t); harness.optIn();
  const written = succeeded(writeNote(harness, GLOW, { text: 'ok' }));
  const responses = [harness.service.read({ matchName: GLOW }), harness.service.read({ matchName: 'Missing' }), written, writeNote(harness, GLOW, { text: '' }), harness.service.audit({}), harness.service.settingsView(),
    harness.service.forget({ kind: 'note', noteId: written.written.id }), harness.service.recordKeptUsage({ planId: 'p', matchName: GLOW, controlPath: AMOUNT, value: 1 }), harness.service.forgetUsage()];
  for (const response of responses) assert.equal(response.writeAuthorizing, false, JSON.stringify(response).slice(0, 120));
});

/** Tests effect-note history and restore: newest first, bounded, with read-before-write and caps. */
import { jsonOf } from '../packages/mcp-server/dist/src/index.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { codeOf, controlPath, currentOf, notesHarness, present, readNotes, refusal, succeeded, writeNote } from './effect-notes-support.ts';
import type { NotesHarnessOptions } from './effect-notes-support.ts';

const GLOW = 'ADBE Glo2', BLUR = 'ADBE Blur', AMOUNT = controlPath(GLOW, 1);

function withHistory(t: TestContext, options?: NotesHarnessOptions) {
  const harness = notesHarness(t, options); harness.optIn();
  const first = writeNote(harness, GLOW, { text: 'First.', controlPath: AMOUNT }), second = writeNote(harness, GLOW, { text: 'Second.', controlPath: AMOUNT });
  const third = writeNote(harness, GLOW, { text: 'Third.', controlPath: AMOUNT, replaces: succeeded(first).written.id, reason: 'Better wording.' });
  return { harness, firstId: succeeded(first).written.id, secondId: succeeded(second).written.id, thirdId: succeeded(third).written.id };
}

test('history is hidden from the agent read and listed for the user, newest first and bounded', t => {
  const { harness, firstId } = withHistory(t);
  assert.equal(readNotes(harness, GLOW).notes.some(note => note.id === firstId), false);
  const second = writeNote(harness, GLOW, { text: 'Fourth.', controlPath: AMOUNT, replaces: readNotes(harness, GLOW).noteIds[0], reason: 'Again.' });
  assert.equal(second.ok, true);
  const audit = succeeded(harness.service.audit({ matchName: GLOW }));
  assert.equal(audit.ok, true); assert.equal(audit.notes.length, 2); assert.equal((audit.notes[0]?.replacedAt ?? 0) >= (audit.notes[1]?.replacedAt ?? 0), true);
  assert.equal(audit.notes.every(note => note.state === 'replaced' && note.matchName === GLOW && note.pluginKey === 'Synthetic'), true);
  assert.equal(succeeded(harness.service.audit({ matchName: BLUR })).notes.length, 0);
  assert.equal(succeeded(harness.service.audit({ limit: 1 })).notes.length, 1);
});

test('restore obeys read-before-write and the caps; at the cap it must replace a current note', t => {
  const { harness, firstId, secondId, thirdId } = withHistory(t);
  const ids = readNotes(harness, GLOW).noteIds;
  assert.equal(codeOf(harness.service.restore({ noteId: firstId, expectedNoteIds: [] })), 'EFFECT_NOTES_STALE');
  const capped = refusal(harness.service.restore({ noteId: firstId, expectedNoteIds: ids }));
  assert.equal(capped.code, 'EFFECT_NOTES_CAP_REACHED'); assert.equal(capped.cap, 'control'); assert.equal(currentOf(capped).notes.length, 2);
  assert.equal(codeOf(harness.service.restore({ noteId: firstId, expectedNoteIds: ids, replaces: secondId })), 'EFFECT_NOTES_INVALID', 'a reason is required');
  const restored = succeeded(harness.service.restore({ noteId: firstId, expectedNoteIds: ids, replaces: secondId, reason: 'The first was better.' }));
  assert.equal(restored.ok, true); assert.equal(restored.restored.id, firstId); assert.equal(restored.notes.length, 2);
  assert.deepEqual(new Set(restored.noteIds), new Set([firstId, thirdId]));
  assert.deepEqual(succeeded(harness.service.audit({ matchName: GLOW })).notes.map(note => [note.id, note.replacedBy]), [[secondId, firstId]]);
  assert.equal(codeOf(harness.service.restore({ noteId: 'nothing', expectedNoteIds: restored.noteIds })), 'EFFECT_NOTES_NOT_FOUND');
  assert.equal(codeOf(harness.service.restore({ noteId: thirdId, expectedNoteIds: restored.noteIds })), 'EFFECT_NOTES_NOT_FOUND', 'a current note is not in history');
});

test('restore below the cap needs no replacement', t => {
  const { harness, firstId } = withHistory(t);
  harness.service.forget(jsonOf({ kind: 'note', noteId: readNotes(harness, GLOW).noteIds[0] }));
  const restored = succeeded(harness.service.restore({ noteId: firstId, expectedNoteIds: readNotes(harness, GLOW).noteIds }));
  assert.equal(restored.ok, true); assert.equal(restored.notes.length, 2);
});

test('forget removes one note, every note of an effect, or every note of a plugin, and says how many', t => {
  const harness = notesHarness(t, { categories: ['Glow', 'Glow'] }); harness.optIn('Glow');
  writeNote(harness, GLOW, { text: 'g1.', controlPath: AMOUNT }); writeNote(harness, GLOW, { text: 'g2.' }); writeNote(harness, BLUR, { text: 'b1.' });
  const g1 = readNotes(harness, GLOW).noteIds[0];
  assert.deepEqual(harness.service.forget(jsonOf({ kind: 'note', noteId: g1 })), { ok: true, removed: 1, writeAuthorizing: false });
  assert.equal(succeeded(harness.service.forget(jsonOf({ kind: 'note', noteId: g1 }))).removed, 0);
  assert.equal(succeeded(harness.service.forget({ kind: 'effect', matchName: GLOW })).removed, 1); assert.equal(readNotes(harness, BLUR).notes.length, 1);
  writeNote(harness, GLOW, { text: 'g3.' });
  assert.equal(succeeded(harness.service.forget({ kind: 'plugin', pluginKey: 'Glow' })).removed, 2);
  assert.equal(readNotes(harness, BLUR).notes.length, 0); assert.equal(codeOf(harness.service.forget({ kind: 'plugin', pluginKey: 7 })), 'EFFECT_NOTES_INVALID');
});

test('forgetting an effect also clears its hidden history', t => {
  const { harness } = withHistory(t);
  assert.equal(succeeded(harness.service.audit({ matchName: GLOW })).notes.length, 1);
  assert.equal(succeeded(harness.service.forget({ kind: 'effect', matchName: GLOW })).removed, 3);
  assert.equal(succeeded(harness.service.audit({})).notes.length, 0);
});

test('plugin opt-in: off by default, per plugin key (AE category, or the match name without one), set and cleared', t => {
  const harness = notesHarness(t, { names: [GLOW, BLUR, 'VENDOR Bare'], categories: ['Stylize', 'Stylize', ''] });
  const view = succeeded(harness.service.settingsView());
  assert.equal(view.ok, true); assert.deepEqual(view.optedIn, []); assert.equal(view.learnFromWork, true); assert.equal(view.hostKey, 'After Effects:26.2:macOS');
  assert.deepEqual(view.plugins, [{ pluginKey: 'Stylize', effectCount: 2, optedIn: false }, { pluginKey: 'VENDOR Bare', effectCount: 1, optedIn: false }]);
  assert.equal(readNotes(harness, 'VENDOR Bare').effect.pluginKey, 'VENDOR Bare');
  assert.equal(codeOf(writeNote(harness, GLOW, { text: 'x' })), 'EFFECT_NOTES_DOCUMENTATION_OFF');
  assert.equal(harness.optIn('Stylize').ok, true);
  assert.equal(readNotes(harness, BLUR).documentationEnabled, true, 'all effects of the plugin');
  assert.equal(readNotes(harness, 'VENDOR Bare').documentationEnabled, false);
  assert.equal(writeNote(harness, BLUR, { text: 'ok' }).ok, true); assert.equal(codeOf(writeNote(harness, 'VENDOR Bare', { text: 'x' })), 'EFFECT_NOTES_DOCUMENTATION_OFF');
  assert.equal(succeeded(harness.service.settingsView()).plugins[0]?.optedIn, true);
  assert.equal(succeeded(harness.optIn('Stylize', false)).enabled, false);
  assert.equal(codeOf(writeNote(harness, GLOW, { text: 'x' })), 'EFFECT_NOTES_DOCUMENTATION_OFF');
  assert.equal(readNotes(harness, BLUR).notes.length, 1, 'clearing the opt-in keeps what was written');
  assert.equal(codeOf(harness.service.setPluginOptIn({ pluginKey: 'Stylize', enabled: 'yes' })), 'EFFECT_NOTES_INVALID');
  assert.equal(codeOf(harness.service.setPluginOptIn({ pluginKey: '', enabled: true })), 'EFFECT_NOTES_INVALID');
});

test('notes survive a restart and are flagged stale when the effect version changes', t => {
  const harness = notesHarness(t); harness.optIn();
  const written = succeeded(writeNote(harness, GLOW, { text: 'Written under v1.', controlPath: AMOUNT }));
  assert.equal(written.written.stale, false);
  harness.restart();
  assert.equal(readNotes(harness, GLOW).notes[0]?.stale, false);
  harness.land({ effectVersion: 'v2' });
  const stale = present(readNotes(harness, GLOW).notes[0]);
  assert.deepEqual([stale.stale, stale.staleReason, stale.effectVersion], [true, 'effect-version', 'v1']);
  assert.equal(readNotes(harness, GLOW).noteIds.length, 1, 'stale notes stay visible and keep their place under the cap');
});

test('notes are flagged stale when the AE build changes, and still match by effect rather than host', t => {
  const harness = notesHarness(t); harness.optIn();
  writeNote(harness, GLOW, { text: 'Written on 26.2.', controlPath: AMOUNT });
  harness.land({ version: '26.3', probe: false });
  const read = readNotes(harness, GLOW), note = present(read.notes[0]);
  assert.deepEqual([note.stale, note.staleReason, note.aeBuild, read.host.aeBuild], [true, 'ae-build', '26.2', '26.3']);
  assert.equal(read.observed.probed, false, 'the new build has not been probed yet; observed facts are never carried across builds');
  const current = succeeded(writeNote(harness, GLOW, { text: 'Written on 26.3.', controlPath: undefined }));
  assert.equal(current.ok, true); assert.equal(current.written.stale, false); assert.equal(current.notes.length, 2);
});

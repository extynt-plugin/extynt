/** Tests the panel's memory settings: the learn flag, plugin opt-in list, filtering, caps and what the words say. */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Reply, TransportError } from '../apps/panel/dist/runtime/panel-transport.js';
import { decode } from '../packages/decode/dist/src/index.js';
import type { Decoder, JsonObject, JsonValue } from '../packages/decode/dist/src/index.js';
import { translatorFor } from '../packages/ui-text/dist/src/index.js';
import {
  PLUGIN_ROWS, REASON_MAX, acknowledged, effectChoices, failureLine, failureSentence, filterPlugins, forgetEffectBody, forgetNoteBody,
  forgetPluginBody, historyAnswer, historySummary, memorySettingsAnswer, notesForgottenLine, outcomeOf as outcomeOfReply,
  pluginListNote, press, readFailure as readTransportFailure, reasonProblem, replacedLine, replaceCandidates, resolveEffect, restoreBody,
  suggestEffects, usageForgottenLine, whyNot,
} from '../apps/panel/dist/runtime/panel-memory.js';
import type { HistoryView, MemorySettings, NoteRow, Outcome, PluginChoice } from '../apps/panel/dist/runtime/panel-memory.js';

type WireInput = JsonValue | undefined;

interface TransportFault {
  readonly message?: string;
  readonly status?: number;
  readonly code?: string;
}

const CONFIRM_MS = 5000;
const tr = translatorFor('en');

function valueOrNull<T>(decoder: Decoder<T>, value: WireInput): T | null {
  const result = decode(decoder, value);
  return result.ok ? result.value : null;
}

function required<T>(value: T | null): T {
  if (value === null) throw new Error('the answer was not read');
  return value;
}

function at<T>(list: ReadonlyArray<T>, index: number): T {
  const found = list[index];
  if (found === undefined) throw new Error(`nothing at ${index}`);
  return found;
}

const transportError = (fault: TransportFault): TransportError => ({
  name: 'TransportError',
  message: fault.message ?? '',
  reason: fault.message ?? '',
  local: false,
  unreachable: fault.status === undefined,
  status: fault.status ?? null,
  code: fault.code ?? null,
});
const readFailure = (fault: TransportFault) => readTransportFailure(transportError(fault));
const readMemorySettings = (value: WireInput): MemorySettings | null => valueOrNull(memorySettingsAnswer, value);
const readHistory = (value: WireInput, matchName: string): HistoryView | null => valueOrNull(historyAnswer(matchName), value);
const replyFor = (fault: TransportFault | null, data: JsonValue): Reply<JsonValue> => {
  if (fault) return { ok: false, error: transportError(fault) };
  return valueOrNull(acknowledged, data) ? { ok: true, value: data } : { ok: false, error: transportError({ status: 0 }) };
};
const outcomeOf = (fault: TransportFault | null, data: JsonValue): Outcome<JsonValue> => outcomeOfReply(replyFor(fault, data));

const CAPS = { perEffect: 5, perControl: 2 };
const note = (id: string, extra: JsonObject = {}): JsonObject => ({ id, kind: 'agent-inferred', trust: 'labelled-guess', controlPath: 'ADBE Glo2-0001', text: `Note ${id}.`, value: null, stale: false, staleReason: null, createdAt: 1, ...extra });
const replaced = (id: string, extra: JsonObject = {}): JsonObject => note(id, { state: 'replaced', replacedBy: 'x', replaceReason: 'Cleaner.', replacedAt: Date.UTC(2026, 9, 3), matchName: 'ADBE Glo2', pluginKey: 'Stylize', ...extra });
const history = (extra: JsonObject = {}): JsonObject => ({ ok: true, notes: [replaced('r1')], current: { effect: { matchName: 'ADBE Glo2', displayName: 'Glow', pluginKey: 'Stylize' }, notes: [note('c1'), note('c2')], noteIds: ['c1', 'c2'], caps: CAPS }, ...extra });
const restoredNote = (controlPath: string | null): NoteRow => ({ id: 'r', state: 'replaced', kindKey: 'memory.kind.note', text: '', controlPath, value: null, stale: null, replaced: null, pluginKey: null });
const failureOf = (code: string) => ({ code });

test('settings need the learn flag and list plugins opted-in first, with opted-in ones the sidecar no longer lists', () => {
  const view = required(readMemorySettings({ ok: true, learnFromWork: false, optedIn: [{ pluginKey: 'Gone', enabledAt: 1 }, { pluginKey: 'Blur', enabledAt: 2 }], plugins: [{ pluginKey: 'Stylize', effectCount: 3, optedIn: false }, { pluginKey: 'Blur', effectCount: 2, optedIn: true }, { pluginKey: 'Blur', effectCount: 9, optedIn: false }, { pluginKey: '', effectCount: 1 }, { effectCount: 1 }] }));
  assert.equal(view.learnFromWork, false);
  assert.deepEqual(view.plugins, [{ key: 'Blur', effectCount: 2, optedIn: true }, { key: 'Gone', effectCount: 0, optedIn: true }, { key: 'Stylize', effectCount: 3, optedIn: false }]);
  const unreadable: readonly WireInput[] = [null, 'x', [], {}, { ok: true }, { ok: false, learnFromWork: true }, { ok: true, learnFromWork: 'yes' }];
  for (const bad of unreadable) assert.equal(readMemorySettings(bad), null, JSON.stringify(bad));
  assert.deepEqual(required(readMemorySettings({ ok: true, learnFromWork: true })).plugins, []);
});

test('the plugin list is filterable and capped, and says what to do when short or empty', () => {
  const plugins: PluginChoice[] = Array.from({ length: 300 }, (_, index) => ({ key: `Plugin ${String(index).padStart(3, '0')}`, effectCount: 1, optedIn: false }));
  const all = filterPlugins(plugins, '', PLUGIN_ROWS);
  assert.equal(all.rows.length, PLUGIN_ROWS); assert.equal(all.matched, 300);
  assert.equal(pluginListNote(tr, { total: 300, shown: all.rows.length, matched: all.matched, query: '' }), 'Showing 100 of 300. Type to narrow the list.');
  const some = filterPlugins(plugins, '  plugin 29 ', PLUGIN_ROWS);
  assert.equal(some.matched, 10); assert.equal(some.rows[0]?.key, 'Plugin 290');
  assert.equal(pluginListNote(tr, { total: 300, shown: 10, matched: 10, query: 'plugin 29' }), '');
  assert.equal(pluginListNote(tr, { total: 300, shown: 0, matched: 0, query: ' zzz ' }), 'No plugin matches “zzz”.');
  assert.match(pluginListNote(tr, { total: 0, shown: 0, matched: 0, query: '' }), /appear here once extynt has learned your effects/);
});

test('a refusal is read from the sidecar body, and a connection problem or an old sidecar gets its own reason', () => {
  const refusal: TransportFault = { status: 409, code: 'EFFECT_NOTES_CAP_REACHED', message: 'Bridge returned HTTP 409' };
  assert.deepEqual(readFailure(refusal), { code: 'EFFECT_NOTES_CAP_REACHED' });
  assert.equal(readFailure({ message: 'Could not reach the bridge.' }).code, 'UNREACHABLE');
  assert.equal(readFailure({ status: 404 }).code, 'UNSUPPORTED');
  assert.equal(readFailure({ status: 500 }).code, 'UNREADABLE');
  assert.equal(outcomeOf(null, { ok: true }).ok, true);
  assert.equal(outcomeOf(null, { ok: false }).ok, false);
  assert.equal(outcomeOf(null, 'text').ok, false);
  assert.equal(whyNot(outcomeOf(null, {})).code, 'UNREADABLE');
  assert.equal(whyNot(outcomeOf(refusal, null)).code, 'EFFECT_NOTES_CAP_REACHED');
});

test('every code the sidecar can answer with reads as a sentence, and no code, status or HTTP text reaches the user', () => {
  const codes = ['STALE_PANEL_INSTANCE', 'EFFECT_NOTES_UNAVAILABLE', 'EFFECT_NOTES_SETTINGS_UNSAVED', 'EFFECT_NOTES_STALE', 'EFFECT_NOTES_CAP_REACHED', 'EFFECT_NOTES_DOCUMENTATION_OFF', 'EFFECT_NOTES_INVALID', 'EFFECT_NOTES_UNKNOWN_EFFECT', 'EFFECT_NOTES_REPLACE_INVALID', 'EFFECT_NOTES_NOT_FOUND', 'UNREACHABLE', 'UNSUPPORTED', 'UNREADABLE', 'SOMETHING_NEW'];
  for (const code of codes) {
    const sentence = failureSentence(tr, failureOf(code));
    assert.match(sentence, /^(?:[A-Z]|extynt ).*[.]$/, code);
    assert.ok(!/[A-Z]{3,}_|HTTP|503|code/.test(sentence), `${code}: ${sentence}`);
  }
  assert.equal(failureLine(tr, 'memory.attempt.load', failureOf('EFFECT_NOTES_SETTINGS_UNSAVED')), 'Memory settings could not be loaded. The setting could not be saved, so nothing changed.');
  assert.equal(failureSentence(tr, failureOf('SOMETHING_NEW')), 'Something went wrong. Nothing was changed.');
});

test('a delete needs the same button pressed twice inside the window, and any other press starts over', () => {
  const first = press(null, 'usage', 1000);
  assert.equal(first.fire, false); assert.deepEqual(first.armed, { key: 'usage', until: 1000 + CONFIRM_MS });
  assert.equal(press(first.armed, 'usage', 1000 + CONFIRM_MS).fire, true, 'inside the window');
  assert.equal(press(first.armed, 'usage', 1001 + CONFIRM_MS).fire, false, 'after the window it only re-arms');
  assert.deepEqual(press(first.armed, 'usage', 1001 + CONFIRM_MS).armed, { key: 'usage', until: 1001 + 2 * CONFIRM_MS });
  const other = press(first.armed, 'note:1', 1200);
  assert.equal(other.fire, false); assert.equal(other.armed?.key, 'note:1');
  assert.equal(press(null, 'usage', 0).fire, false);
});

test('the history reads current and replaced notes in plain words, with the effect, plugin, ids and caps', () => {
  const view = required(readHistory(history({ notes: [replaced('r1', { stale: true, staleReason: 'effect-version', value: [1, 2], kind: 'measured' })] }), 'ADBE Glo2'));
  assert.equal(view.known, true); assert.equal(view.effectName, 'Glow'); assert.equal(view.pluginKey, 'Stylize');
  assert.deepEqual(view.noteIds, ['c1', 'c2']); assert.deepEqual(view.caps, CAPS);
  assert.deepEqual(view.current.map((row) => [row.id, row.state, row.kindKey, row.replaced]), [['c1', 'current', 'memory.kind.guess', null], ['c2', 'current', 'memory.kind.guess', null]]);
  const row = at(view.replaced, 0);
  assert.equal(row.state, 'replaced'); assert.equal(row.kindKey, 'memory.kind.measured'); assert.equal(row.value, '1, 2'); assert.equal(row.controlPath, 'ADBE Glo2-0001');
  assert.equal(row.stale, 'memory.stale.effectVersion'); assert.equal(row.replaced ? replacedLine(tr, row.replaced) : '', 'Replaced 2026-10-03: Cleaner.');
  assert.equal(at(required(readHistory(history({ notes: [replaced('r1', { stale: true, staleReason: 'ae-build' })] }), 'x')).replaced, 0).stale, 'memory.stale.aeBuild');
  const plain = at(required(readHistory(history({ notes: [replaced('r1', { replaceReason: null, replacedAt: null })] }), 'x')).replaced, 0);
  assert.equal(plain.replaced ? replacedLine(tr, plain.replaced) : '', 'Replaced.');
  assert.equal(historySummary(tr, view), 'Glow: 2 current notes of 5, 1 replaced note.');
  const unreadable: readonly WireInput[] = [null, {}, { ok: false }, 'x'];
  for (const bad of unreadable) assert.equal(readHistory(bad, 'x'), null);
});

test('an effect the sidecar has not learned, or one with no notes, says so; the plugin falls back to a replaced note', () => {
  const unknown = required(readHistory({ ok: true, notes: [], current: null }, 'Nope'));
  assert.equal(unknown.known, false); assert.equal(unknown.effectName, 'Nope'); assert.equal(unknown.pluginKey, null);
  assert.equal(historySummary(tr, unknown), 'extynt has not learned an effect with that name yet.');
  const empty = required(readHistory({ ok: true, notes: [], current: { effect: { matchName: 'A', displayName: 'A', pluginKey: 'P' }, notes: [], noteIds: [], caps: CAPS } }, 'A'));
  assert.equal(empty.known, true);
  assert.match(historySummary(tr, empty), /^No notes for A yet\. Notes appear once an agent writes them, and only for plugins you chose to document\.$/);
  const orphan = required(readHistory({ ok: true, notes: [replaced('r1')], current: null }, 'ADBE Glo2'));
  assert.equal(orphan.known, true); assert.equal(orphan.pluginKey, 'Stylize', 'a replaced note carries its plugin when the effect is no longer installed');
  const bad = required(readHistory({ ok: true, notes: [{ id: '', text: 'x' }, { id: 'a' }, null, replaced('r2')], current: { notes: [note('c1'), { id: 'c2' }], noteIds: ['c1', 7], caps: { perEffect: 'x' } } }, 'm'));
  assert.deepEqual(bad.replaced.map((row) => row.id), ['r2']); assert.deepEqual(bad.current.map((row) => row.id), ['c1']); assert.deepEqual(bad.noteIds, ['c1']); assert.equal(bad.caps, null);
});

test('a restore sends the ids last read, and at the limit the note it replaces and a one-line reason', () => {
  assert.deepEqual(restoreBody('r1', ['c1', 'c2']), { noteId: 'r1', expectedNoteIds: ['c1', 'c2'] });
  assert.deepEqual(restoreBody('r1', ['c1'], { replaces: 'c1', reason: 'Back to the first.' }), { noteId: 'r1', expectedNoteIds: ['c1'], replaces: 'c1', reason: 'Back to the first.' });
  assert.equal(reasonProblem(''), 'memory.reason.empty');
  assert.equal(reasonProblem('   '), 'memory.reason.empty');
  assert.equal(reasonProblem('a'.repeat(REASON_MAX + 1)), 'memory.reason.long');
  assert.equal(reasonProblem('one\ntwo'), 'memory.reason.long');
  assert.equal(reasonProblem(' Cleaner. '), null); assert.equal(reasonProblem('a'.repeat(REASON_MAX)), null);
  assert.equal(tr('memory.reason.empty'), 'Say in a few words why it replaces that note.');
});

test('when the control is full only that control’s notes can be replaced, otherwise any current note', () => {
  const rows = required(readHistory(history({ current: { effect: { matchName: 'A', displayName: 'A', pluginKey: 'P' }, notes: [note('a1'), note('a2'), note('b1', { controlPath: 'ADBE Glo2-0002' }), note('e1', { controlPath: null })], noteIds: ['a1', 'a2', 'b1', 'e1'], caps: CAPS } }), 'A')).current;
  const restored = restoredNote('ADBE Glo2-0001');
  assert.deepEqual(replaceCandidates(restored, rows, CAPS).map((row) => row.id), ['a1', 'a2']);
  assert.deepEqual(replaceCandidates(restoredNote('ADBE Glo2-0002'), rows, CAPS).map((row) => row.id), ['a1', 'a2', 'b1', 'e1']);
  assert.deepEqual(replaceCandidates(restoredNote(null), rows, CAPS).map((row) => row.id), ['a1', 'a2', 'b1', 'e1']);
  assert.equal(replaceCandidates(restored, rows, null).length, 4);
});

test('each forget names its scope and what it deletes, in plain words', () => {
  assert.deepEqual(forgetNoteBody('n1'), { scope: 'note', noteId: 'n1' });
  assert.deepEqual(forgetEffectBody('ADBE Glo2'), { scope: 'effect', matchName: 'ADBE Glo2' });
  assert.deepEqual(forgetPluginBody('Stylize'), { scope: 'plugin', pluginKey: 'Stylize' });
  assert.equal(usageForgottenLine(tr, 3), 'Forgot what extynt learned from your work (3 items).');
  assert.equal(usageForgottenLine(tr, 1), 'Forgot what extynt learned from your work (1 item).');
  assert.equal(usageForgottenLine(tr, 0), 'There was nothing to forget.');
  assert.equal(notesForgottenLine(tr, 2), 'Forgot 2 notes.');
  assert.equal(notesForgottenLine(tr, 1), 'Forgot 1 note.');
  assert.equal(notesForgottenLine(tr, 0), 'There were no notes to forget.');
});

test('effects are found by name from the host census, names that start with the text first, and a typed name stands for its match name', () => {
  const census = { ok: true, result: { installedEffects: [{ matchName: 'ADBE Glo2', displayName: 'Glow', category: 'Stylize' }, { matchName: 'ADBE Blur', displayName: 'Gaussian Blur', category: 'Blur' }, { matchName: 'ADBE Gone', displayName: 'Gone', available: false }, { displayName: 'No match name' }, 'x'] } };
  const choices = effectChoices(census);
  assert.deepEqual(choices.map((choice) => choice.matchName), ['ADBE Glo2', 'ADBE Blur']);
  assert.deepEqual(effectChoices(null), []); assert.deepEqual(effectChoices({ result: {} }), []);
  assert.deepEqual(suggestEffects(choices, 'g', 8).map((choice) => choice.displayName), ['Glow', 'Gaussian Blur']);
  assert.deepEqual(suggestEffects(choices, 'blur', 8).map((choice) => choice.displayName), ['Gaussian Blur']);
  assert.deepEqual(suggestEffects(choices, 'g', 1).length, 1); assert.deepEqual(suggestEffects(choices, '  ', 8), []);
  assert.equal(resolveEffect(choices, 'glow'), 'ADBE Glo2'); assert.equal(resolveEffect(choices, ' ADBE Blur '), 'ADBE Blur');
  assert.equal(resolveEffect(choices, 'Something Else'), 'Something Else'); assert.equal(resolveEffect([], 'Glow'), 'Glow');
});

/** Tests the effect-notes tables: strict schema, check constraints and additive opening of older catalogues. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { numberOf, textOf } from '../apps/sidecar/dist/tests/http-json.js';
import { openGraphFile } from '../apps/sidecar/dist/src/graph-file.js';
import { EFFECT_NOTES_TABLE_CHECK, EFFECT_NOTES_TABLE_COUNT } from '../apps/sidecar/dist/src/effect-notes-schema.js';
import { ProjectGraphStore } from '../apps/sidecar/dist/src/project-graph-store.js';
import { census } from './catalogue-support.ts';
import { notesHarness, refusal } from './effect-notes-support.ts';

const TABLES = ['effect_value_notes', 'effect_value_usage', 'effect_value_usage_plans', 'effect_usage_events', 'animation_habit_samples', 'effect_note_plugin_optin'];
function temporary(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'extynt-notes-schema-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
const count = (database: DatabaseSync, table: string): number => numberOf(database.prepare(`SELECT count(*) AS total FROM ${table}`).get(), 'total');
const tableTotal = (database: DatabaseSync): number => numberOf(database.prepare(EFFECT_NOTES_TABLE_CHECK).get(), 'total');

interface HabitSampleRow {
  readonly kind: string;
  readonly duration: number;
  readonly keyframes: number;
  readonly easing: string;
  readonly influence: number | null;
}

test('the host catalogue gains STRICT notes tables with checks, and starts with no notes data at all', t => {
  const harness = notesHarness(t), db = new DatabaseSync(textOf(harness.graph.status(), 'catalogue.path'), { readOnly: true });
  t.after(() => db.close());
  assert.equal(tableTotal(db), EFFECT_NOTES_TABLE_COUNT);
  for (const name of TABLES) {
    assert.equal(count(db, name), 0, `${name} is never seeded`);
    assert.match(textOf(db.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(name), 'sql'), /STRICT/);
    for (const column of db.prepare(`PRAGMA table_info(${name})`).all()) assert.ok(['INTEGER', 'TEXT', 'REAL'].includes(textOf(column, 'type')), `${name}.${textOf(column, 'name')}`);
  }
  assert.equal(count(db, 'installed_effects') > 0, true, 'the catalogue itself has this machine\'s census');
});

test('the CHECK constraints refuse a bad kind, an over-long note, a history row without a reason and a kept row with no plan', t => {
  const directory = temporary(t), database = openGraphFile(join(directory, 'host-catalogue.extynt'));
  t.after(() => database.close());
  const note = (kind: string, text: string, state: string, reason: string | null) => database.prepare(`INSERT INTO effect_value_notes(id,match_name,plugin_key,kind,text,ae_build,state,created_at,replace_reason,replaced_at) VALUES('n','m','p',?,?,'26.2',?,1,?,?)`).run(kind, text, state, reason, reason === null ? null : 1);
  assert.throws(() => note('usage', 'ok', 'current', null), /CHECK/); assert.throws(() => note('measured', 'x'.repeat(281), 'current', null), /CHECK/);
  assert.throws(() => note('measured', 'two\nlines', 'current', null), /CHECK/); assert.throws(() => note('measured', 'ok', 'replaced', null), /CHECK/);
  assert.throws(() => note('measured', 'ok', 'current', 'a reason on a current note'), /CHECK/);
  assert.doesNotThrow(() => note('agent-inferred', 'x'.repeat(280), 'current', null));
  const usage = (source: string, plan: string | null, slot: string) => database.prepare(`INSERT INTO effect_value_usage(match_name,control_path,source,value_text,plan_id,slot,recorded_at) VALUES('m','c',?,'1',?,?,1)`).run(source, plan, slot);
  assert.throws(() => usage('kept', null, ''), /CHECK/); assert.throws(() => usage('seen', null, ''), /CHECK/); assert.throws(() => usage('guessed', 'p', ''), /CHECK/);
  assert.doesNotThrow(() => usage('kept', 'p', '')); assert.doesNotThrow(() => usage('seen', null, 'where'));
  assert.throws(() => database.prepare("INSERT INTO effect_note_plugin_optin VALUES('',1)").run(), /CHECK/);
  const event = (kind: string, source: string, plan: string | null, slot: string) => database.prepare(`INSERT INTO effect_usage_events(kind,name,source,plan_id,slot,recorded_at) VALUES(?,'m',?,?,?,1)`).run(kind, source, plan, slot);
  assert.throws(() => event('plugin', 'kept', 'p', ''), /CHECK/); assert.throws(() => event('effect', 'kept', null, ''), /CHECK/); assert.throws(() => event('effect', 'seen', null, ''), /CHECK/); assert.throws(() => event('effect', 'guessed', 'p', ''), /CHECK/);
  assert.doesNotThrow(() => event('effect', 'kept', 'p', '')); assert.doesNotThrow(() => event('font', 'seen', null, 'layer'));
  assert.throws(() => event('effect', 'kept', 'p', ''), /UNIQUE/, 'a plan counts an effect once');
  const habit = (fields: Partial<HabitSampleRow>) => { const row: HabitSampleRow = { kind: 'opacity', duration: 1, keyframes: 2, easing: 'linear', influence: null, ...fields }; return database.prepare('INSERT INTO animation_habit_samples(plan_id,slot,property_kind,duration,keyframes,easing,influence,recorded_at) VALUES(?,?,?,?,?,?,?,1)').run('p', 's', row.kind, row.duration, row.keyframes, row.easing, row.influence); };
  for (const bad of [{ kind: '' }, { duration: 0 }, { duration: 90000 }, { keyframes: 1 }, { keyframes: 2000 }, { easing: '' }, { easing: 'bezier', influence: 0 }]) assert.throws(() => habit(bad), /CHECK/, JSON.stringify(bad));
  assert.doesNotThrow(() => habit({ duration: 0.6, easing: 'bezier', influence: 40 })); assert.throws(() => habit({ duration: 0.6 }), /UNIQUE/, 'a plan records a property once per slot');
});

test('an existing catalogue file without the tables gains them when opened, keeping every row it had', t => {
  const directory = temporary(t), path = join(directory, 'graphs', 'host-catalogue.extynt');
  const store = new ProjectGraphStore(directory);
  store.observeCensus(census(['ADBE Glo2']), 100);
  store.close();
  const old = new DatabaseSync(path);
  for (const name of TABLES) old.exec(`DROP TABLE ${name}`);
  assert.equal(tableTotal(old), 0);
  const effects = old.prepare('SELECT * FROM installed_effects').all();
  old.close();
  const reopened = openGraphFile(path);
  t.after(() => reopened.close());
  assert.equal(tableTotal(reopened), EFFECT_NOTES_TABLE_COUNT);
  assert.deepEqual(reopened.prepare('SELECT * FROM installed_effects').all(), effects);
  const again = openGraphFile(path);
  again.close();
  const afterStore = new ProjectGraphStore(directory);
  t.after(() => afterStore.close());
  assert.equal(afterStore.effectNotes.optIns().ok, true, 'the store works on the migrated file');
});

test('a partially migrated file (one notes table missing) is completed on open', t => {
  const directory = temporary(t), path = join(directory, 'host-catalogue.extynt');
  openGraphFile(path).close();
  const old = new DatabaseSync(path);
  old.exec('DROP TABLE effect_note_plugin_optin');
  old.close();
  const reopened = openGraphFile(path);
  t.after(() => reopened.close());
  assert.equal(count(reopened, 'effect_note_plugin_optin'), 0);
});

test('every project file also carries the (empty) tables, but notes only ever read and write the host catalogue', t => {
  const directory = temporary(t), store = new ProjectGraphStore(directory);
  t.after(() => store.close());
  store.observeCensus(census(['ADBE Glo2']), 100);
  assert.equal(store.effectNotes.optIns().ok, true);
  assert.equal(textOf(store.status(), 'catalogue.path'), join(directory, 'graphs', 'host-catalogue.extynt'));
});

test('storage trouble comes back as a coded refusal and never throws', t => {
  const directory = temporary(t);
  mkdirSync(join(directory, 'graphs'), { recursive: true });
  writeFileSync(join(directory, 'graphs', 'host-catalogue.extynt'), 'this is not a sqlite database at all, just text', { mode: 0o600 });
  const store = new ProjectGraphStore(directory);
  t.after(() => store.close());
  const results = [store.effectNotes.read({ matchName: 'ADBE Glo2' }), store.effectNotes.write({ matchName: 'ADBE Glo2', text: 'x', expectedNoteIds: [] }, 1), store.effectNotes.optIns(),
    store.effectNotes.recordKeptUsage({ planId: 'p', matchName: 'm', controlPath: 'c', value: 1 }, 1), store.effectNotes.forgetUsage(), store.effectNotes.audit({}), store.effectNotes.forget({ kind: 'effect', matchName: 'm' })];
  for (const result of results) { assert.equal(result.ok, false); assert.match(refusal(result).code, /^GRAPH_/); assert.equal(result.writeAuthorizing, false); }
});

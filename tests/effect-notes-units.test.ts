/** Tests that effect-note reads carry the host's unit labels and where each factory default sits in range. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { group, prop } from './catalogue-support.ts';
import type { ControlRow } from './catalogue-support.ts';
import { notesHarness, present, readNotes } from './effect-notes-support.ts';

const FX = 'ADBE Synthetic Fx';
const controls = (name: string): ControlRow[] => [
  prop(`${name}-0001`, { name: 'Size', defaultValue: 50, hasMin: true, min: 0, hasMax: true, max: 200, units: 'pixels' }),
  prop(`${name}-0002`, { name: 'Mix', defaultValue: 1, hasMin: true, min: 0, hasMax: true, max: 4 }),
  prop(`${name}-0003`, { name: 'Free', defaultValue: 3, units: 'degrees' }),
  prop(`${name}-0004`, { name: 'Zero', defaultValue: 0, hasMin: true, min: -10, hasMax: true, max: 10 }),
  prop(`${name}-0005`, { name: 'Choice', defaultValue: 2, hasMin: true, min: 1, hasMax: true, max: 3, isDropdown: true, items: ['A', 'B', 'C'] }),
  prop(`${name}-0006`, { name: 'Origin', valueType: 'TwoD', defaultValue: [10, 20], hasMin: true, min: 0, hasMax: true, max: 100, units: 'pixels' }),
  prop(`${name}-0007`, { name: 'Flat', defaultValue: 5, hasMin: true, min: 5, hasMax: true, max: 5 }),
  group(`${name}-Group`, [prop(`${name}-Inner`, { name: 'Inner', defaultValue: 0 })]),
];

test('an effect-notes read carries the unit label AE reported and where the factory default sits in the reported range, and says what the range is', t => {
  const harness = notesHarness(t, { names: [FX], controls });
  const read = readNotes(harness, FX);
  assert.equal(read.ok, true);
  assert.match(read.observed.rangeNote, /Range as reported by After Effects/); assert.match(read.observed.rangeNote, /slider range/);
  const by = new Map(read.observed.controls.map(control => [control.name, control]));
  const of = (name: string) => present(by.get(name));
  assert.deepEqual([of('Size').units, of('Size').minimum, of('Size').maximum, of('Size').defaultValue, of('Size').defaultPosition], ['pixels', 0, 200, 50, 0.25]);
  assert.deepEqual([of('Mix').units, of('Mix').defaultPosition], [null, 0.25], 'no unit label reported, none shown');
  assert.deepEqual([of('Free').units, of('Free').minimum, of('Free').maximum, of('Free').defaultPosition], ['degrees', null, null, null], 'a unit label without a range has no position');
  assert.equal(of('Zero').defaultPosition, 0.5);
  assert.equal(of('Choice').defaultPosition, null, 'a menu has no proportion');
  assert.deepEqual([of('Origin').units, of('Origin').defaultPosition], ['pixels', null], 'a vector has no single position');
  assert.equal(of('Flat').defaultPosition, null, 'a degenerate range has no position');
  assert.equal(of('Inner').units, null);
  assert.equal(present(read.observed.controls.find(control => control.group)).defaultPosition, null);
});

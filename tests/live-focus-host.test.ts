/** Tests the host pulse: it names the project, the composition and the selected layers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { hostTextFunction, loadHostFiles } from '../apps/panel/dist/tests/host-sources.js';
import { jsonObject } from '../packages/decode/dist/src/index.js';
import type { JsonObject } from '../packages/decode/dist/src/index.js';
import { fieldOf, maybeListOf, parseJson, textOf } from '../apps/sidecar/dist/tests/http-json.js';
import { decodeOrThrow } from '../packages/decode/dist/src/index.js';

interface SelectedLayer {
  readonly id: number;
  readonly index: number;
  readonly name: string;
}

interface ProjectFile {
  readonly fsName: string;
  readonly name: string;
}

interface FakeHostOptions {
  readonly layers?: readonly SelectedLayer[];
  readonly file?: ProjectFile | null;
  readonly comp?: boolean;
}

interface FakeHost {
  readonly pulse: () => JsonObject;
}

const DEFAULT_FILE: ProjectFile = { fsName: '/Users/a/Projects/promo.aep', name: 'promo.aep' };

function fakeHost({ layers = [], file = DEFAULT_FILE, comp = true }: FakeHostOptions = {}): FakeHost {
  class CompItem {
    id = 12; name = 'Main Comp'; selectedLayers = layers;
  }
  class FolderItem {}
  const project = { numItems: 3, item: () => { throw new Error('NO_DOM_TRAVERSAL'); }, activeItem: comp ? new CompItem() : null, file, revision: 9 };
  const context = vm.createContext({ app: { project, version: '26.2.1', effects: [] }, CompItem, FolderItem, $: { os: 'Mac' } });
  loadHostFiles(context, 'collection.jsx');
  const read = hostTextFunction(context, 'aeCollectionPulse');
  return { pulse: () => decodeOrThrow(jsonObject, parseJson(read(''))) };
}
const layer = (index: number): SelectedLayer => ({ id: 100 + index, index, name: `Layer ${index}` });

test('the pulse names the open project, the composition and the selected layers', () => {
  const pulse = fakeHost({ layers: [layer(2), layer(5)] }).pulse();
  assert.equal(fieldOf(pulse, 'ok'), true);
  assert.equal(fieldOf(pulse, 'projectPath'), '/Users/a/Projects/promo.aep'); assert.equal(fieldOf(pulse, 'projectName'), 'promo.aep');
  assert.equal(fieldOf(pulse, 'active'), '12'); assert.equal(fieldOf(pulse, 'activeName'), 'Main Comp');
  assert.deepEqual(fieldOf(pulse, 'selected'), ['102', '105']);
  assert.deepEqual(fieldOf(pulse, 'selectedLayers'), [{ id: '102', index: 2, name: 'Layer 2' }, { id: '105', index: 5, name: 'Layer 5' }]);
  assert.equal(fieldOf(pulse, 'revision'), 9); assert.equal(fieldOf(pulse, 'items'), 3);
});

test('an unsaved project has no path and the pulse still reports its name', () => {
  const pulse = fakeHost({ file: null }).pulse();
  assert.equal(fieldOf(pulse, 'projectPath'), null); assert.equal(fieldOf(pulse, 'projectName'), 'Untitled');
});

test('no open composition: nothing selected, no names', () => {
  const pulse = fakeHost({ comp: false }).pulse();
  assert.equal(fieldOf(pulse, 'active'), null); assert.equal(fieldOf(pulse, 'activeName'), null);
  assert.deepEqual(fieldOf(pulse, 'selected'), []); assert.deepEqual(fieldOf(pulse, 'selectedLayers'), []);
});

test('the selection is bounded: 256 ids, 64 named layers, names cut to 128 characters', () => {
  const many = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, index: i + 1, name: 'x'.repeat(400) }));
  const pulse = fakeHost({ layers: many }).pulse();
  assert.equal(maybeListOf(pulse, 'selected')?.length, 256); assert.equal(maybeListOf(pulse, 'selectedLayers')?.length, 64);
  assert.equal(textOf(pulse, 'selectedLayers.0.name').length, 128);
  assert.ok(JSON.stringify(pulse).length < 16000, 'a pulse stays small');
});

test('a layer that cannot be read leaves the pulse answering, with the focus fields unknown', () => {
  const broken: SelectedLayer = { get id(): number { throw new Error('gone'); }, index: 1, name: 'x' };
  const pulse = fakeHost({ layers: [broken] }).pulse();
  assert.equal(fieldOf(pulse, 'ok'), true); assert.equal(fieldOf(pulse, 'selected'), undefined); assert.equal(fieldOf(pulse, 'active'), undefined);
  assert.equal(fieldOf(pulse, 'projectName'), 'promo.aep', 'the project identity does not depend on the layers');
});

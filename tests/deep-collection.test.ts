/** Tests resumable deep property collection: paging without values, cursor safety and late-page suppression. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { decodeOrThrow, jsonObject } from '../packages/decode/dist/src/index.js';
import type { JsonObject } from '../packages/decode/dist/src/index.js';
import { CollectionCoordinator } from '../packages/collection/dist/src/coordinator.js';
import type { CollectionPage } from '../packages/collection/dist/src/coordinator.js';
import { hostPartNames, hostTextFunction, loadHostFiles } from '../apps/panel/dist/tests/host-sources.js';
import { fieldOf, listOf, numberOf, parseJson, textOf } from '../apps/sidecar/dist/tests/http-json.js';

interface HostLeaf { readonly name: string; readonly matchName: string; readonly numProperties: number; readonly value: never }
interface HostLayer { readonly id: number; readonly name: string; numProperties: number; property(index: number): HostLeaf | undefined }
interface DeepHost { readonly layer: HostLayer; call(request: JsonObject): JsonObject }
interface FakeFile { readonly fsName: string; readonly parent: { readonly fsName: string } }
class FolderItem {}

function hostLeaf(index: number): HostLeaf {
  return { name: `Property ${index}`, matchName: 'ADBE Value', numProperties: 0, get value(): never { throw new Error('VALUES_MUST_NOT_BE_READ'); } };
}
function host(): DeepHost {
  const leaves = Array.from({ length: 70 }, (_, i) => hostLeaf(i));
  const layer: HostLayer = { id: 9, name: 'Layer', numProperties: leaves.length, property: index => leaves[index - 1] };
  class CompItem { id = 7; numLayers = 1; layer(index: number): HostLayer | null { return index === 1 ? layer : null; } }
  const comp = new CompItem();
  const project = { numItems: 1, item: () => comp };
  const context = vm.createContext({ app: { project }, CompItem, FolderItem, JSON, Date });
  loadHostFiles(context, 'host-shared.jsx');
  loadHostFiles(context, 'collection.jsx');
  const collectDetailPage = hostTextFunction(context, 'aeCollectDetailPage');
  return { layer, call: request => decodeOrThrow(jsonObject, parseJson(collectDetailPage(JSON.stringify(request)))) };
}
const layerPages = { kind: 'properties', itemIndex: 1, compositionId: '7', layerIndex: 1, layerId: '9' };
test('resumable property descriptors traverse all pages without reading values', async () => {
  const h = host(), pages: CollectionPage[] = [];
  const coordinator = new CollectionCoordinator({ callPage: async (request: JsonObject) => h.call(request), yieldHost: async () => {} });
  const onPage = (received: CollectionPage | undefined): void => { if (received !== undefined) pages.push(received); };
  const result = await coordinator.collectDetails(layerPages, { onPage });
  assert.equal(fieldOf(result, 'count'), 70); assert.equal(fieldOf(result, 'deepComplete'), false);
  assert.equal(fieldOf(result, 'dependencyClosure'), 'unknown'); assert.equal(pages.length, 3);
  assert.equal(fieldOf(listOf(pages[2], 'rows').at(-1), 'path'), 'ADBE Value#70');
  assert.ok(pages.every(p => listOf(p, 'rows').length <= 25 && listOf(p, 'rows').every(row => fieldOf(row, 'valueState') === 'not-read')));
});
test('cursor cannot resume against replacement target or changed property collection', () => {
  const h = host();
  const first = h.call({ schemaVersion: '0.1', requestId: 'x', begin: true, ...layerPages });
  h.layer.numProperties++;
  const next = h.call({ schemaVersion: '0.1', requestId: 'y', sessionId: textOf(first, 'sessionId'), cursor: numberOf(first, 'nextCursor') });
  assert.equal(next.ok, false); assert.equal(fieldOf(next, 'error.code'), 'PROJECT_CHANGED');
});
test('mutation invalidation suppresses late deep page publication', async () => {
  let resolve: (page: JsonObject) => void = () => {}, pages = 0;
  const coordinator = new CollectionCoordinator({ callPage: () => new Promise<JsonObject>(done => { resolve = done; }) });
  const pending = coordinator.collectDetails({ kind: 'layers' }, { onPage: () => pages++ });
  coordinator.pauseForMutation(); resolve({ ok: true });
  assert.equal(fieldOf(await pending, 'state'), 'cancelled'); assert.equal(pages, 0);
});
test('manifest probe loads the sibling catalog and catalogue adapters, without host reads', () => {
  const loaded: string[] = [];
  function File(path: string): FakeFile { return { fsName: path, parent: { fsName: '/installed/panel/host' } }; }
  const context = vm.createContext({ JSON, Date, File, $: { fileName: '/installed/panel/host/probe.jsx', evalFile: (file: FakeFile) => loaded.push(file.fsName) } });
  loadHostFiles(context, 'probe.jsx');
  assert.deepEqual(loaded, [...hostPartNames('probe.jsx'), 'collection.jsx', 'catalogue.jsx'].map(name => '/installed/panel/host/' + name));
  assert.ok(loaded.length > 2);
});

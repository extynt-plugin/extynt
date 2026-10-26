/** Tests the collection gate against the native bridge: revision refusal and what the pulse names. */
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { decodeOrThrow, jsonObject } from '../packages/decode/dist/src/index.js';
import type { JsonObject } from '../packages/decode/dist/src/index.js';
import { compareTranscript } from './collection-gate-support.ts';
import type { Harness, ReadDispatch, Target } from './collection-gate-support.ts';
import { fieldOf, listOf, numberOf, parseJson, textOf } from '../apps/sidecar/dist/tests/http-json.js';
import { hostTextFunction, loadHostFiles } from '../apps/panel/dist/tests/host-sources.js';

interface HostProperty {
  readonly name: string; readonly matchName: string; readonly numProperties: number; readonly propertyValueType: number;
  readonly numKeys: number; readonly expressionEnabled: boolean; readonly expression: string;
  keyTime(index: number): number; keyValue(index: number): number;
}
interface HostLayer {
  readonly id: number; readonly name: string; readonly locked: boolean; readonly selected: boolean;
  readonly numProperties: number; property(): HostProperty;
}
class CompItem {
  id = 7; name = 'Comp'; width = 1920; height = 1080; duration = 10; frameRate = 30; numLayers = 3;
  private readonly layers: readonly HostLayer[];
  constructor(layers: readonly HostLayer[]) { this.layers = layers; }
  layer(index: number): HostLayer | undefined { return this.layers[index - 1]; }
  get selectedLayers(): HostLayer[] { return this.layers.filter(candidate => candidate.selected); }
}
class FolderItem {}
class Clock extends Date { override getTime(): number { return 1000; } }
interface HostProject { revision: number; readonly numItems: number; item(): CompItem; activeItem: CompItem | null; readonly file: null }
interface NativeHost {
  readonly project: HostProject;
  readonly context: vm.Context;
  getters(): number;
  target(kind: string): Target;
}

function hostLayers(property: HostProperty): HostLayer[] {
  return Array.from({ length: 3 }, (_, i) => ({ id: i + 9, name: `Layer ${i}`, locked: false, selected: i === 0, numProperties: 1, property: () => property }));
}
function nativeHost(): NativeHost {
  let getters = 0;
  const property: HostProperty = {
    name: 'Opacity', matchName: 'ADBE Opacity', numProperties: 0, propertyValueType: 1, numKeys: 7, expressionEnabled: false, expression: '',
    keyTime: index => index / 10, keyValue(index) { getters++; return index; },
  };
  const comp = new CompItem(hostLayers(property)), project: HostProject = { revision: 4, numItems: 1, item: () => comp, activeItem: comp, file: null };
  const context = vm.createContext({ app: { project, version: '26.2', buildNumber: 2 }, CompItem, FolderItem, PropertyValueType: { OneD: 1 }, Date: Clock, JSON, Array, $: { os: 'Synthetic Linux' } });
  loadHostFiles(context, 'host-shared.jsx');
  loadHostFiles(context, 'collection.jsx');
  const pulse = decodeOrThrow(jsonObject, parseJson(hostTextFunction(context, 'aeCollectionPulse')('')));
  const expectedStamp = { epoch: numberOf(pulse, 'project'), revision: numberOf(pulse, 'revision') };
  const target = (kind: string): Target => ({ kind, itemIndex: 1, compositionId: '7', layerIndex: 1, layerId: '9', propertyIndices: [1], expectedStamp });
  return { project, context, getters: () => getters, target };
}
function nativePage(host: NativeHost, dispatch: ReadDispatch): JsonObject {
  return decodeOrThrow(jsonObject, parseJson(hostTextFunction(host.context, dispatch.hostFunction)(JSON.stringify(dispatch.hostRequest))));
}
function pageAll(h: Harness, host: NativeHost, kind: string): { rows: number; last: JsonObject } {
  const scope = host.target(kind);
  let d = h.start({ begin: true, target: scope, maxRows: 2 }), rows = 0, last: JsonObject = {};
  for (;;) {
    h.admit(d);
    const native = nativePage(host, d), nativeRows = listOf(native, 'rows');
    assert.equal(native.ok, true); assert.ok(nativeRows.length <= 2);
    last = h.finish(d, native); assert.equal(last.ok, true); rows += nativeRows.length;
    h.evidence(d, scope, nativeRows.map(row => textOf(row, 'id')));
    if (native.nextCursor === null) return { rows, last };
    d = h.start({ jobId: d.jobId, maxRows: 2 });
  }
}
for (const kind of ['layers', 'properties', 'values']) test(`actual collection.jsx ${kind} pages match immutable service with real SQLite`, () => {
  compareTranscript(h => {
    const host = nativeHost(), { rows, last } = pageAll(h, host, kind);
    h.emit('native-getters', () => host.getters());
    assert.equal(host.getters(), kind === 'values' ? 7 : 0);
    assert.equal(rows, kind === 'layers' ? 3 : kind === 'values' ? 7 : 1);
    if (kind === 'layers') assert.equal(listOf(last, 'snapshot.result.compositions.0.layers').length, 3);
  });
});
test('actual native revision refusal preserves the host code and invalidates prior SQLite observations', () => {
  compareTranscript(h => {
    const host = nativeHost(), scope = host.target('values'), first = h.start({ begin: true, target: scope, maxRows: 2 }); h.admit(first);
    h.finish(first, nativePage(host, first));
    const next = h.start({ jobId: first.jobId, maxRows: 2 }); h.admit(next); host.project.revision++;
    const native = nativePage(host, next);
    assert.equal(fieldOf(native, 'error.code'), 'PROJECT_CHANGED');
    assert.deepEqual(h.finish(next, native), { thrown: 'PROJECT_CHANGED' });
    assert.equal(fieldOf(h.service.demandResult(next.ticket), 'error.code'), 'PROJECT_CHANGED'); h.evidence(next, scope);
    assert.equal(host.getters(), 2); assert.equal(listOf(h.service.queryCache({ target: scope }), 'rows').length, 0);
  });
});
test('the pulse names the open composition and its selected layers, which the revision alone cannot show', () => {
  const host = nativeHost(), pulse = hostTextFunction(host.context, 'aeCollectionPulse'), open = decodeOrThrow(jsonObject, parseJson(pulse('')));
  assert.equal(open.active, '7'); assert.deepEqual(open.selected, ['9']);
  host.project.activeItem = null;
  const closed = decodeOrThrow(jsonObject, parseJson(pulse('')));
  assert.equal(closed.ok, true); assert.equal(closed.active, null); assert.deepEqual(closed.selected, []); assert.equal(closed.revision, 4);
});

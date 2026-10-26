/** Tests the production sidecar collecting every demanded key page under one revision. */
import { jsonOf } from '../packages/mcp-server/dist/src/index.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { decodeOrThrow, jsonObject } from '../packages/decode/dist/src/index.js';
import type { JsonObject } from '../packages/decode/dist/src/index.js';
import { CollectionService } from '../apps/sidecar/dist/src/collection-service.js';
import { hostTextFunction, loadHostFiles } from '../apps/panel/dist/tests/host-sources.js';
import { fieldOf, listOf, numberOf, parseJson, textOf } from '../apps/sidecar/dist/tests/http-json.js';
import type { Target } from './collection-gate-support.ts';

interface KeyedProperty {
  readonly name: string; readonly matchName: string; readonly numProperties: number; readonly propertyValueType: number;
  numKeys: number; expressionEnabled: boolean; expression: string; readonly value: number;
  keyTime(index: number): number; keyValue(index: number): number;
}
interface ProductionHost {
  readonly project: { revision: number };
  readonly property: KeyedProperty;
  readonly target: Target;
  run(entry: string, request: JsonObject): JsonObject;
}

function keyedProperty(): KeyedProperty {
  return {
    name: 'Opacity', matchName: 'ADBE Opacity', numProperties: 0, propertyValueType: 1, numKeys: 70, expressionEnabled: false, expression: '', value: 50,
    keyTime: index => index / 10, keyValue: index => index,
  };
}
function host(): ProductionHost {
  const property = keyedProperty();
  const layer = { id: 9, name: 'Layer', numProperties: 1, property: () => property };
  class CompItem { id = 7; numLayers = 1; layer(): typeof layer { return layer; } }
  const comp = new CompItem(), project = { revision: 4, numItems: 1, item: () => comp };
  const context = vm.createContext({ app: { project }, CompItem, FolderItem: class {}, PropertyValueType: { OneD: 1 }, Date, JSON, Array });
  loadHostFiles(context, 'collection.jsx');
  const run = (entry: string, request: JsonObject): JsonObject => {
    return decodeOrThrow(jsonObject, parseJson(hostTextFunction(context, entry)(JSON.stringify(request))));
  };
  const stamp = run('aeCollectionPulse', {});
  const expectedStamp = { epoch: numberOf(stamp, 'project'), revision: numberOf(stamp, 'revision') };
  const target: Target = { kind: 'values', itemIndex: 1, compositionId: '7', layerIndex: 1, layerId: '9', propertyIndices: [1], expectedStamp };
  return { project, property, target, run };
}
const requestOf = (prepared: JsonObject): JsonObject => decodeOrThrow(jsonObject, prepared.hostRequest);
const nativePage = (h: ProductionHost, prepared: JsonObject): JsonObject => h.run(textOf(prepared, 'hostFunction'), requestOf(prepared));
const valuePage = (h: ProductionHost, prepared: JsonObject): JsonObject => h.run('aeCollectValuePage', requestOf(prepared));
const directRequest: JsonObject = { schemaVersion: '0.1', requestId: 'x', begin: true };
function pairedService(): CollectionService {
  const service = new CollectionService();
  service.pair('panel');
  return service;
}
test('production sidecar drives all demanded key pages under one revision', () => {
  const h = host(), service = pairedService();
  let begin = true, jobId: string | undefined, count = 0;
  for (;;) {
    const prepared = service.prepare(jsonOf({ begin, jobId, target: h.target }), false);
    service.authorizeDispatch({ ticket: textOf(prepared, 'ticket') });
    const page = nativePage(h, prepared);
    assert.equal(page.ok, true, JSON.stringify(page));
    const accepted = service.complete({ ticket: textOf(prepared, 'ticket'), page });
    const rows = listOf(accepted, 'page.rows').length;
    count += rows; jobId = textOf(accepted, 'jobId'); begin = false;
    assert.ok(rows <= 25);
    if (fieldOf(accepted, 'page.nextCursor') === null) break;
  }
  assert.equal(count, 70);
});
test('expressions are never evaluated and unknown dependency coverage is preserved', () => {
  const h = host(); h.property.numKeys = 0; h.property.expressionEnabled = true; h.property.expression = 'time*10';
  Object.defineProperty(h.property, 'value', { get() { throw new Error('EXPRESSION_EVALUATION'); } });
  const page = h.run('aeCollectValuePage', { ...h.target, ...directRequest });
  assert.equal(page.ok, true); assert.equal(fieldOf(page, 'rows.0.valueState'), 'unknown'); assert.equal(page.dependencyClosure, 'unknown');
});
test('stale ordinal paths are refused before a demanded value getter', () => {
  const h = host(); h.project.revision++;
  Object.defineProperty(h.property, 'value', { get() { throw new Error('MUST_NOT_READ'); } });
  const page = h.run('aeCollectValuePage', { ...h.target, ...directRequest });
  assert.equal(fieldOf(page, 'error.code'), 'STALE_TARGET');
});
test('small service page budget is honored by native key reader', () => {
  const h = host(), service = pairedService();
  const prepared = service.prepare({ begin: true, target: h.target, maxRows: 2 }, false);
  service.authorizeDispatch({ ticket: textOf(prepared, 'ticket') });
  const page = valuePage(h, prepared);
  assert.equal(listOf(page, 'rows').length, 2); assert.equal(fieldOf(service.complete({ ticket: textOf(prepared, 'ticket'), page }), 'ok'), true);
});
test('mutation cancellation rejects late native pages without releasing an active read early', () => {
  const h = host(), service = pairedService();
  const prepared = service.prepare({ begin: true, target: h.target }, false);
  service.authorizeDispatch({ ticket: textOf(prepared, 'ticket') });
  service.invalidate();
  assert.throws(() => service.prepare({ begin: true, target: h.target }, false), /COLLECTION_BUSY/);
  const page = valuePage(h, prepared);
  assert.throws(() => service.complete({ ticket: textOf(prepared, 'ticket'), page }), /COLLECTION_CANCELLED/);
  assert.equal(fieldOf(service.lookup('missing'), 'state'), 'unknown');
  assert.equal(fieldOf(service.prepare({ begin: true, target: h.target }, false), 'ok'), true);
});
test('duplicate completion cannot release a newer service ticket', () => {
  const h = host(), service = pairedService();
  const first = service.prepare({ begin: true, target: h.target }, false);
  service.authorizeDispatch({ ticket: textOf(first, 'ticket') });
  const page = valuePage(h, first);
  service.complete({ ticket: textOf(first, 'ticket'), page });
  const second = service.prepare({ jobId: textOf(first, 'jobId') }, false);
  assert.throws(() => service.complete({ ticket: textOf(first, 'ticket'), page }), /STALE_COLLECTION_TICKET/);
  assert.throws(() => service.prepare({ jobId: textOf(second, 'jobId') }, false), /COLLECTION_BUSY/);
});

test('panel replacement retires the unresolved read instead of quarantining; the next demand starts fresh', () => {
  const service = new CollectionService(); service.pair('a');
  const old = service.prepare({ begin: true, target: { kind: 'index' } }, false), oldTicket = textOf(old, 'ticket');
  service.pair('b');
  assert.equal(service.nativeAccessQuarantine(), null); assert.equal(service.hasUnsettled(oldTicket), false);
  assert.throws(() => service.complete({ ticket: oldTicket, page: {} }), /STALE_COLLECTION_TICKET/);
  assert.notEqual(textOf(service.prepare({ begin: true, target: { kind: 'index' } }, false), 'ticket'), oldTicket);
});

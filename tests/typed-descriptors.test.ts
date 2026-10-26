/** Tests bounded native property discovery that reports types and ranges without reading values. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { hostTextFunction, loadHostFiles } from '../apps/panel/dist/tests/host-sources.js';
import { fieldOf, numberOf, parseJson, recordsOf } from '../apps/sidecar/dist/tests/http-json.js';

test('bounded native property discovery reports types/ranges without reading values or evaluating expressions', () => {
  const types = { OneD: 1, CUSTOM_VALUE: 2, NO_VALUE: 3 }, propertyTypes = { PROPERTY: 1, INDEXED_GROUP: 2 };
  let valueReads = 0;
  const amount = { name: 'Amount', matchName: 'Vendor-Amount', propertyValueType: 1, propertyType: 1, numProperties: 0, hasMin: true, hasMax: true, minValue: 0, maxValue: 100, canVaryOverTime: true, canSetExpression: true, get value() { valueReads++; throw Error('MUST_NOT_EVALUATE'); } };
  const custom = { name: 'Custom', matchName: 'Vendor-Custom', propertyValueType: 2, propertyType: 1, numProperties: 0, get hasMin() { throw Error('UNSUPPORTED'); } };
  const effect = { name: 'Effect', matchName: 'Vendor-Effect', propertyType: 2, numProperties: 2, property: (index: number) => [amount, custom][index - 1] };
  const layer = { id: 8, numProperties: 1, property: () => effect };
  class CompItem { id = 7; numLayers = 1; layer() { return layer; } }
  const project = { revision: 4, numItems: 1, file: { name: 'Saved.aep', fsName: '/synthetic/Saved.aep' }, item: () => new CompItem() };
  const host = vm.createContext({ app: { project, version: '26.2' }, CompItem, FolderItem: class {}, PropertyValueType: types, PropertyType: propertyTypes });
  loadHostFiles(host, 'host-shared.jsx');
  loadHostFiles(host, 'collection.jsx');
  const collectDetailPage = hostTextFunction(host, 'aeCollectDetailPage');
  const result = parseJson(collectDetailPage(JSON.stringify({ schemaVersion: '0.1', requestId: 'descriptor', begin: true, kind: 'properties', itemIndex: 1, compositionId: '7', layerIndex: 1, layerId: '8', pageSize: 25 })));
  const rows = recordsOf(result, 'rows');
  assert.equal(fieldOf(result, 'ok'), true); assert.equal(fieldOf(result, 'nextCursor'), null); assert.equal(rows.length, 3);
  assert.equal(fieldOf(rows, '0.propertyType'), 'INDEXED_GROUP');
  assert.equal(fieldOf(rows, '1.valueType'), 'OneD'); assert.equal(numberOf(rows, '1.minimum'), 0); assert.equal(numberOf(rows, '1.maximum'), 100);
  assert.equal(fieldOf(rows, '1.canVaryOverTime'), true); assert.equal(fieldOf(rows, '1.canSetExpression'), true);
  assert.equal(fieldOf(rows, '2.valueType'), 'CUSTOM_VALUE'); assert.equal(fieldOf(rows, '2.minimum'), null);
  assert.equal(fieldOf(rows, '2.valueState'), 'not-read'); assert.equal(valueReads, 0);
  assert.equal(fieldOf(result, 'project.filePath'), '/synthetic/Saved.aep');
});

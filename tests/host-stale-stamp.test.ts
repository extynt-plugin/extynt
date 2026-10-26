/** Tests that a plan is refused, as not applied, when the project moved on since the sidecar read it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { hostText, hostTextFunction, loadHostFiles } from '../apps/panel/dist/tests/host-sources.js';
import { jsonObject } from '../packages/decode/dist/src/index.js';
import type { JsonObject, JsonValue } from '../packages/decode/dist/src/index.js';
import { fieldOf, numberOf, parseJson } from '../apps/sidecar/dist/tests/http-json.js';
import { decodeOrThrow } from '../packages/decode/dist/src/index.js';

const probeSource = hostText('probe.jsx');

interface PlanExtras {
  readonly expectedStamp?: JsonValue;
}

interface FakeLayer {
  id: number;
  index: number;
  name: string;
  locked: boolean;
  selected: boolean;
  enabled: boolean;
  property: () => null;
  numProperties: number;
}

interface StaleStampHost {
  readonly project: { revision: number };
  readonly layers: readonly FakeLayer[];
  readonly seen: { groups: number };
  readonly stamp: () => JsonObject;
  readonly apply: (extra: PlanExtras) => JsonObject;
}

const objectOf = (text: string): JsonObject => decodeOrThrow(jsonObject, parseJson(text));

function host(): StaleStampHost {
  const seen = { groups: 0 };
  class FolderItem {}
  const layers: FakeLayer[] = [{ id: 11, index: 1, name: 'Old', locked: false, selected: false, enabled: true, property: () => null, numProperties: 0 }];
  class CompItem {
    id = 7; name = 'Main'; width = 1920; height = 1080; duration = 10; frameRate = 24; numLayers = 1; layers = layers;
    layer(n: number) { return this.layers[n - 1]; }
  }
  const comp = new CompItem(), project = { revision: 40, numItems: 1, item: () => comp, file: null, activeItem: comp };
  const app = { project, version: '26.2.1', buildNumber: 2, beginUndoGroup() { seen.groups += 1; }, endUndoGroup() {} };
  const context = vm.createContext({ app, CompItem, FolderItem, $: { os: 'Mac' } });
  loadHostFiles(context, 'collection.jsx'); vm.runInContext(probeSource, context);
  const pulse = hostTextFunction(context, 'aeCollectionPulse'), applyPlan = hostTextFunction(context, 'aeApplyPlan');
  const command = (extra: PlanExtras): string => JSON.stringify({ operation: 'apply_plan', planId: 'p1', undoGroup: 'extynt - p1', operations: [{ operation: 'set_layer_name', compositionId: '7', layerId: '11', name: 'New' }], ...extra });
  return { project, layers, seen, stamp: () => objectOf(pulse('')), apply: extra => objectOf(applyPlan(command(extra))) };
}

function layerName(h: StaleStampHost): string | undefined {
  return h.layers[0]?.name;
}

test('a plan whose stamp is still the project\'s applies', () => {
  const h = host(), pulse = h.stamp(), result = h.apply({ expectedStamp: { epoch: numberOf(pulse, 'project'), revision: numberOf(pulse, 'revision') } });
  assert.equal(fieldOf(result, 'ok'), true, JSON.stringify(result)); assert.equal(layerName(h), 'New'); assert.equal(h.seen.groups, 1);
});

test('a project that moved on since the sidecar read it is refused before any write, as not applied', () => {
  const h = host(), pulse = h.stamp(), expectedStamp = { epoch: numberOf(pulse, 'project'), revision: numberOf(pulse, 'revision') };
  h.project.revision += 1;
  const result = h.apply({ expectedStamp });
  assert.equal(fieldOf(result, 'ok'), false); assert.equal(fieldOf(result, 'error.code'), 'STALE_STAMP');
  assert.equal(fieldOf(result, 'mayHaveMutated'), false); assert.equal(fieldOf(result, 'mutationState'), 'not-applied');
  assert.equal(layerName(h), 'Old', 'nothing was written'); assert.equal(h.seen.groups, 0, 'not even an undo group was opened');
});

test('another project (a different epoch) and a malformed stamp are refused the same way', () => {
  const stamps: readonly JsonValue[] = [{ epoch: 99, revision: 40 }, { epoch: 1 }, { epoch: '1', revision: '40' }, null, 'x'];
  for (const stamp of stamps) {
    const h = host(), result = h.apply({ expectedStamp: stamp });
    assert.equal(fieldOf(result, 'ok'), false, JSON.stringify(stamp)); assert.equal(fieldOf(result, 'error.code'), 'STALE_STAMP');
    assert.equal(fieldOf(result, 'mayHaveMutated'), false); assert.equal(h.seen.groups, 0);
  }
});

test('a plan without a stamp is applied as it always was', () => {
  const h = host(), result = h.apply({});
  assert.equal(fieldOf(result, 'ok'), true); assert.equal(layerName(h), 'New');
});

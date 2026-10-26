// add_marker on a composition's own marker stream: an identical marker already there is the add done (a re-run of a
// batch that landed but could not be checked), nothing is written; a different marker at that time is refused and named.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { hostText, hostTextFunction, loadHostFiles } from '../apps/panel/dist/tests/host-sources.js';
import { jsonObject } from '../packages/decode/dist/src/index.js';
import type { JsonObject } from '../packages/decode/dist/src/index.js';
import { fieldOf, parseJson, textOf } from '../apps/sidecar/dist/tests/http-json.js';
import { decodeOrThrow } from '../packages/decode/dist/src/index.js';

const probeSource = hostText('probe.jsx');

class FolderItem {}

class MarkerValue {
  comment: string;
  duration = 0;
  chapter = '';
  url = '';
  cuePointName = '';
  label = 0;
  constructor(comment: string) {
    this.comment = comment;
  }
}

interface MarkerEntry {
  time: number;
  value: MarkerValue;
}

interface MarkerWrite {
  readonly time: number;
  readonly comment: string;
}

interface AddMarker {
  readonly operation: 'add_marker';
  readonly compositionId: string;
  readonly time: number;
  readonly comment: string;
}

interface MarkerHost {
  readonly apply: (operations: readonly AddMarker[]) => JsonObject;
  readonly writes: MarkerWrite[];
  readonly markers: MarkerEntry[];
  readonly marker: (time: number, comment: string) => MarkerEntry;
}

function markerEntryAt(markers: readonly MarkerEntry[], index: number): MarkerEntry {
  const entry = markers[index - 1];
  if (entry === undefined) throw new Error(`no marker key ${index}`);
  return entry;
}

function markerPropertyOver(markers: MarkerEntry[], writes: MarkerWrite[]) {
  return {
    get numKeys() { return markers.length; },
    keyTime: (index: number) => markerEntryAt(markers, index).time,
    keyValue: (index: number) => markerEntryAt(markers, index).value,
    setValueAtTime(time: number, value: MarkerValue) {
      writes.push({ time, comment: value.comment });
      const at = markers.findIndex(marker => marker.time === time);
      if (at >= 0) markers[at] = { time, value }; else markers.push({ time, value });
    },
    removeKey(index: number) { markers.splice(index - 1, 1); },
  };
}

function host(markers: MarkerEntry[] = []): MarkerHost {
  const writes: MarkerWrite[] = [];
  const markerProperty = markerPropertyOver(markers, writes);
  class CompItem {
    id = 7; name = 'Main'; width = 1920; height = 1080; duration = 30; frameRate = 30; numLayers = 0; layers = []; markerProperty = markerProperty;
    layer(n: number) { return this.layers[n - 1]; }
  }
  const comp = new CompItem(), project = { revision: 40, numItems: 1, item: () => comp, file: null, activeItem: comp };
  const app = { project, version: '26.2.1', buildNumber: 2, beginUndoGroup() {}, endUndoGroup() {} };
  const context = vm.createContext({ app, CompItem, FolderItem, MarkerValue, $: { os: 'Mac' } });
  loadHostFiles(context, 'collection.jsx'); vm.runInContext(probeSource, context);
  const marker = (time: number, comment: string): MarkerEntry => ({ time, value: new MarkerValue(comment) });
  const applyPlan = hostTextFunction(context, 'aeApplyPlan');
  const apply = (operations: readonly AddMarker[]): JsonObject => decodeOrThrow(jsonObject, parseJson(applyPlan(JSON.stringify({ operation: 'apply_plan', planId: 'p1', undoGroup: 'extynt - p1', operations }))));
  return { apply, writes, markers, marker };
}

const add = (time: number, comment: string): AddMarker => ({ operation: 'add_marker', compositionId: '7', time, comment });

test('a new composition marker is written', () => {
  const h = host(), result = h.apply([add(2, '02 WRONG LAYER')]);
  assert.equal(fieldOf(result, 'ok'), true, JSON.stringify(result));
  assert.deepEqual(h.writes, [{ time: 2, comment: '02 WRONG LAYER' }]);
});

test('an identical marker already there is the add done: nothing is written and the step says so', () => {
  const h = host();
  h.markers.push(h.marker(0, '01 REQUEST'));
  const result = h.apply([add(0, '01 REQUEST'), add(2, '02 WRONG LAYER')]);
  assert.equal(fieldOf(result, 'ok'), true, JSON.stringify(result));
  assert.deepEqual(h.writes, [{ time: 2, comment: '02 WRONG LAYER' }], 'only the new marker was written');
  assert.equal(fieldOf(result, 'steps.0.alreadyPresent'), true);
  assert.equal(fieldOf(result, 'steps.1.alreadyPresent'), undefined);
});

test('a different marker at that time is refused before any write, and the refusal names it', () => {
  const h = host();
  h.markers.push(h.marker(2, '02 WRONG LAYER'));
  const result = h.apply([add(2, '02 WRONG_LAYER')]);
  assert.equal(fieldOf(result, 'ok'), false);
  assert.equal(fieldOf(result, 'error.code'), 'MARKER_EXISTS');
  assert.match(textOf(result, 'error.message'), /02 WRONG LAYER.*update_marker/);
  assert.deepEqual(h.writes, []);
});

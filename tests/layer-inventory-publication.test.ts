/** Tests that a scoped snapshot publishes only a complete, contiguous layer inventory. */
import { jsonOf } from '../packages/mcp-server/dist/src/index.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CollectionService } from '../apps/sidecar/dist/src/collection-service.js';
import { fieldOf, listOf, textOf } from '../apps/sidecar/dist/tests/http-json.js';

interface Stamp {
  epoch: number;
  revision: number | null;
}

interface LayerRow {
  id: string;
  name: string;
  index: number;
  layerIndex: number;
  locked: boolean | string;
  selected: boolean;
  detail: string;
  properties: string;
  values: string;
  stamp?: Stamp;
  compositionId?: string;
}

interface CompositionMetadata {
  id: string;
  itemIndex: number;
  name: string | undefined;
  width: number;
  height: number;
  duration: number;
  frameRate: number;
}

interface PageMetadata {
  composition: CompositionMetadata;
  runtime: { application: string };
  project: { name: string };
  activeCompositionId: string;
  layerCount: number;
}

interface LayerPage {
  ok: true;
  requestId: string;
  sessionId: string;
  kind: 'layers';
  stamp: Stamp;
  rows: LayerRow[];
  nextCursor: number | null;
  metadata: PageMetadata | null;
  deepComplete: false;
}

type PageMutation = (page: LayerPage) => void;
type NamedMutation = readonly [string, PageMutation];

const target = { kind: 'layers', itemIndex: 2, compositionId: 'comp' };

const setup = (): CollectionService => {
  const service = new CollectionService();
  service.pair('p');
  return service;
};

const row = (n: number): LayerRow => ({ id: 'layer-' + n, name: 'Layer ' + n, index: n, layerIndex: n, locked: false, selected: false, detail: 'layer-index', properties: 'unknown', values: 'not-read' });

const metadata = (count: number): PageMetadata => ({
  composition: { id: 'comp', itemIndex: 2, name: 'Comp', width: 1920, height: 1080, duration: 10, frameRate: 25 },
  runtime: { application: 'After Effects' },
  project: { name: 'P' },
  activeCompositionId: 'comp',
  layerCount: count,
});

function dispatch(service: CollectionService, begin = true, jobId?: string): string {
  const prepared = service.prepare(jsonOf({ begin, jobId, target, maxRows: 2 }), false);
  const ticket = textOf(prepared, 'ticket');
  service.authorizeDispatch({ ticket });
  return ticket;
}

function page(ticket: string, rows: LayerRow[], nextCursor: number | null, meta: PageMetadata | null = metadata(3)): LayerPage {
  return { ok: true, requestId: ticket, sessionId: 'session', kind: 'layers', stamp: { epoch: 1, revision: 1 }, rows, nextCursor, metadata: meta, deepComplete: false };
}

const cacheKey = (id: string): string => JSON.stringify(['layers', 'comp', null, null, id]);

function metadataOf(layerPage: LayerPage): PageMetadata {
  if (layerPage.metadata === null) throw new Error('page has no metadata');
  return layerPage.metadata;
}

function rowOf(layerPage: LayerPage, index: number): LayerRow {
  const found = layerPage.rows[index];
  if (found === undefined) throw new Error(`page has no row ${index}`);
  return found;
}

function assertUnknown(service: CollectionService, layerId: string): void {
  assert.equal(textOf(service.lookup(cacheKey(layerId)), 'state'), 'unknown');
}

test('only complete contiguous unique inventory publishes scoped snapshot', () => {
  const s = setup(), a = dispatch(s);
  const first = s.complete(jsonOf({ ticket: a, page: page(a, [row(1), row(2)], 3) }));
  assert.equal(fieldOf(first, 'snapshot'), undefined);
  const b = dispatch(s, false, textOf(first, 'jobId')), end = s.complete(jsonOf({ ticket: b, page: page(b, [row(3)], null) }));
  assert.equal(listOf(end, 'snapshot.result.compositions.0.layers').length, 3);
  assert.equal(fieldOf(end, 'snapshot.result.coverage.otherCompositions'), 'unknown');
});

const rejectedMutations: readonly NamedMutation[] = [
  ['duplicate ID', p => { rowOf(p, 1).id = rowOf(p, 0).id; }],
  ['shifted index', p => { rowOf(p, 1).index = 3; }],
  ['shifted layerIndex', p => { rowOf(p, 1).layerIndex = 3; }],
  ['early end', p => { p.nextCursor = null; }],
  ['omitted row', p => { p.rows.pop(); }],
  ['wrong composition', p => { metadataOf(p).composition.id = 'other'; }],
  ['wrong comp ordinal', p => { metadataOf(p).composition.itemIndex = 3; }],
  ['invalid name', p => { metadataOf(p).composition.name = undefined; }],
  ['row stamp mismatch', p => { rowOf(p, 0).stamp = { epoch: 1, revision: 2 }; }],
  ['row comp mismatch', p => { rowOf(p, 0).compositionId = 'other'; }],
  ['invalid lock', p => { rowOf(p, 0).locked = 'false'; }],
];

for (const [name, mutate] of rejectedMutations) {
  test(name + ' rejects before any cache publication', () => {
    const s = setup(), a = dispatch(s), p = page(a, [row(1), row(2)], 3);
    mutate(p);
    assert.throws(() => s.complete(jsonOf({ ticket: a, page: p })));
    assertUnknown(s, 'layer-1');
    assertUnknown(s, 'layer-2');
  });
}

const invalidatingMutations: readonly NamedMutation[] = [
  ['cross-page duplicate', p => { rowOf(p, 0).id = 'layer-1'; }],
  ['count change', p => { metadataOf(p).layerCount = 4; }],
  ['name change', p => { metadataOf(p).composition.name = 'Changed'; }],
  ['project change', p => { metadataOf(p).project.name = 'Changed'; }],
  ['stamp change', p => { p.stamp.revision = 2; }],
];

for (const [name, mutate] of invalidatingMutations) {
  test(name + ' invalidates prefix and never publishes absent claims', () => {
    const s = setup(), a = dispatch(s);
    const first = s.complete(jsonOf({ ticket: a, page: page(a, [row(1), row(2)], 3) }));
    const b = dispatch(s, false, textOf(first, 'jobId')), p = page(b, [row(3)], null);
    mutate(p);
    assert.throws(() => s.complete(jsonOf({ ticket: b, page: p })));
    assertUnknown(s, 'layer-1');
    assertUnknown(s, 'layer-3');
  });
}

test('empty composition requires exact zero count', () => {
  const s = setup(), a = dispatch(s);
  const done = s.complete(jsonOf({ ticket: a, page: page(a, [], null, metadata(0)) }));
  assert.equal(listOf(done, 'snapshot.result.compositions.0.layers').length, 0);
});

test('revision unavailable remains observational with no complete snapshot', () => {
  const s = setup(), a = dispatch(s), p = page(a, [row(1)], null, null);
  p.stamp.revision = null;
  assert.equal(fieldOf(s.complete(jsonOf({ ticket: a, page: p })), 'snapshot'), undefined);
  assertUnknown(s, 'absent');
});

/** Tests that a host read touches the effects census only when asked for it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { hostText, hostTextFunction, loadHostFiles } from '../apps/panel/dist/tests/host-sources.js';
import { decodeOrThrow, jsonValue } from '../packages/decode/dist/src/index.js';
import type { JsonValue } from '../packages/decode/dist/src/index.js';
import { fieldOf, listOf, numberOf, parseJson, recordsOf } from '../apps/sidecar/dist/tests/http-json.js';

const probeSource = hostText('probe.jsx');

interface Touched { effects: number; itemCalls: number; files: number; byId: number; encodes: number }
interface HostOptions { readonly itemByID?: boolean; readonly effects?: number }
interface ProbeRequest { readonly [key: string]: JsonValue }
interface Folder { readonly id: number }
interface Source { readonly isStill: boolean }
interface FootageFile { readonly fsName: string }
interface FakeItem { readonly id: number }
interface FakeProject {
  numItems: number;
  item(n: number): FakeItem | undefined;
  activeItem: FakeItem | undefined;
  file: null;
  itemByID?: (id: number) => FakeItem | null;
}
interface Harness {
  readonly context: vm.Context;
  readonly touched: Touched;
  raw(request: ProbeRequest): string;
  read(request: ProbeRequest): JsonValue;
  reset(): void;
}

class FolderItem {}

type ItemClasses = ReturnType<typeof createItemClasses>;

function createItemClasses(touched: Touched) {
  class CompItem implements FakeItem {
    readonly id: number;
    readonly name: string;
    readonly selectedLayers: readonly number[] = [];
    readonly parentFolder: Folder = { id: 0 };
    readonly numLayers = 0;
    readonly width = 1920;
    readonly height = 1080;
    constructor(id: number) { this.id = id; this.name = `Comp ${id}`; }
  }
  class FootageItem implements FakeItem {
    readonly id: number;
    readonly name: string;
    readonly parentFolder: Folder = { id: 0 };
    readonly mainSource: Source = { isStill: false };
    constructor(id: number) { this.id = id; this.name = `Footage ${id}`; }
    get file(): FootageFile { touched.files += 1; return { fsName: `/media/${this.id}.mov` }; }
  }
  return { CompItem, FootageItem };
}

function createProject(touched: Touched, classes: ItemClasses, itemByID: boolean): FakeProject {
  const { CompItem, FootageItem } = classes;
  const items = [new FootageItem(1), new CompItem(2), new FootageItem(3), new CompItem(4), new FootageItem(5)];
  const project: FakeProject = { numItems: items.length, item(n) { touched.itemCalls += 1; return items[n - 1]; }, activeItem: items[1], file: null };
  if (itemByID) project.itemByID = id => { touched.byId += 1; return items.find(item => item.id === id) ?? null; };
  return project;
}

interface EffectList { readonly length: number }

function createEffectList(touched: Touched, effects: number): EffectList {
  const effectList = { get length() { touched.effects += 1; return effects; } };
  for (let i = 0; i < effects; i += 1) Object.defineProperty(effectList, i, { get() { touched.effects += 1; return { matchName: `ADBE Effect ${i}`, displayName: `Effect ${i}` }; } });
  return effectList;
}

function host({ itemByID = true, effects = 3 }: HostOptions = {}): Harness {
  const touched: Touched = { effects: 0, itemCalls: 0, files: 0, byId: 0, encodes: 0 };
  const classes = createItemClasses(touched);
  const project = createProject(touched, classes, itemByID);
  const encode = (text: string): string => { touched.encodes += 1; return encodeURIComponent(text); };
  const app = { project, version: '26.2.1', buildNumber: 2, effects: createEffectList(touched, effects) };
  const context = vm.createContext({ app, CompItem: classes.CompItem, FolderItem, $: { os: 'Mac' }, encodeURIComponent: encode });
  loadHostFiles(context, 'collection.jsx'); vm.runInContext(probeSource, context);
  const probe = hostTextFunction(context, 'aeEyesOpenProbe');
  const raw = (request: ProbeRequest): string => probe(JSON.stringify({ schemaVersion: '0.1', requestId: 'r', ...request }));
  const reset = (): void => { touched.effects = 0; touched.itemCalls = 0; touched.files = 0; touched.byId = 0; touched.encodes = 0; };
  return { context, touched, raw, read: request => decodeOrThrow(jsonValue, parseJson(raw(request))), reset };
}

function compositionIdsOf(answer: JsonValue): JsonValue[] {
  return recordsOf(answer, 'result.compositions').map(composition => decodeOrThrow(jsonValue, fieldOf(composition, 'id')));
}

test('a read that does not ask for the effects census never touches app.effects, and says the inventory is unknown', () => {
  const h = host(), answer = h.read({});
  assert.equal(fieldOf(answer, 'ok'), true); assert.equal(h.touched.effects, 0, 'the installed-effects walk is skipped');
  assert.deepEqual(fieldOf(answer, 'result.installedEffects'), []);
  assert.equal(fieldOf(answer, 'result.capabilityEnumeration.effects'), 'unknown', 'an empty list here is silence, not an empty install');
  assert.equal(fieldOf(h.read({ includeEffects: false }), 'result.capabilityEnumeration.effects'), 'unknown');
  assert.equal(h.touched.effects, 0);
});

test('a read that asks for the effects census gets it; with no project open the census rides along only when asked', () => {
  const h = host(), answer = h.read({ includeEffects: true });
  assert.equal(listOf(answer, 'result.installedEffects').length, 3); assert.equal(fieldOf(answer, 'result.capabilityEnumeration.effects'), 'enumerable');
  vm.runInContext('app.project = null', h.context); h.reset();
  const quiet = h.read({}); assert.equal(fieldOf(quiet, 'error.code'), 'NO_PROJECT'); assert.equal(fieldOf(quiet, 'error.details'), undefined); assert.equal(h.touched.effects, 0);
  assert.equal(listOf(h.read({ includeEffects: true }), 'error.details.hostCensus.items').length, 3, 'the startup census still reads from an empty host');
});

test('compositionIds with includeItems false fetch only those compositions: no item list, no footage file, readScope echoed', () => {
  const h = host(), answer = h.read({ compositionIds: ['4'], includeItems: false });
  assert.equal(fieldOf(answer, 'ok'), true);
  assert.deepEqual(compositionIdsOf(answer), ['4']);
  assert.deepEqual(fieldOf(answer, 'result.items'), []); assert.deepEqual(fieldOf(answer, 'result.sources'), []);
  assert.equal(h.touched.files, 0, 'footage file paths are never read'); assert.equal(h.touched.itemCalls, 0, 'item(i) is not walked when itemByID exists'); assert.equal(h.touched.byId, 1);
  assert.equal(numberOf(answer, 'result.itemCount'), 5); assert.deepEqual(fieldOf(answer, 'result.readScope'), { compositions: 'listed', items: 'skipped' });
});

test('without itemByID the listed read walks the items checking only type and id: still no footage file', () => {
  const h = host({ itemByID: false }), answer = h.read({ compositionIds: ['2', '4'], includeItems: false });
  assert.deepEqual(compositionIdsOf(answer), ['2', '4']);
  assert.equal(h.touched.files, 0); assert.ok(h.touched.itemCalls <= 5);
  assert.deepEqual(fieldOf(answer, 'result.items'), []); assert.deepEqual(fieldOf(answer, 'result.sources'), []);
  assert.deepEqual(fieldOf(answer, 'result.readScope'), { compositions: 'listed', items: 'skipped' });
});

test('a full read reads every item and reports its scope and item count; compositionIds alone still reads the items', () => {
  const h = host(), full = h.read({});
  assert.deepEqual(fieldOf(full, 'result.readScope'), { compositions: 'all', items: 'read' }); assert.equal(numberOf(full, 'result.itemCount'), 5);
  assert.equal(listOf(full, 'result.items').length, 5); assert.equal(listOf(full, 'result.sources').length, 3); assert.ok(h.touched.files >= 3, 'a full read does read the footage files');
  const listed = h.read({ compositionIds: ['4'] });
  assert.deepEqual(fieldOf(listed, 'result.readScope'), { compositions: 'listed', items: 'read' }); assert.equal(listOf(listed, 'result.items').length, 5);
  assert.deepEqual(fieldOf(h.read({ includeItems: false }), 'result.readScope'), { compositions: 'all', items: 'read' }, 'includeItems alone does not narrow a read of every composition');
});

test('a small payload is measured by length alone: encodeURIComponent is not called, and the wrapper returns the one serialization', () => {
  const h = host(), text = h.raw({ limits: { maxPayloadBytes: 1000000 } });
  assert.equal(typeof text, 'string'); assert.equal(fieldOf(parseJson(text), 'ok'), true); assert.equal(h.touched.encodes, 0);
});

test('a payload over the limit is refused with PAYLOAD_LIMIT, measured exactly in the band between length and three times the length', () => {
  const small = host().read({ limits: { maxPayloadBytes: 1024 } });
  assert.equal(fieldOf(small, 'ok'), false); assert.equal(fieldOf(small, 'error.code'), 'PAYLOAD_LIMIT'); assert.equal(fieldOf(small, 'error.details.limit'), 1024);
  const full = host().read({}), bytes = Buffer.byteLength(JSON.stringify(full), 'utf8');
  const h = host(), band = h.read({ limits: { maxPayloadBytes: bytes + 40 } });
  assert.equal(fieldOf(band, 'ok'), true, 'a payload that fits the limit is accepted'); assert.equal(h.touched.encodes, 1, 'only the band between length and 3x length is counted');
  const exact = host().read({ limits: { maxPayloadBytes: Math.max(1024, bytes - 50) } });
  assert.equal(fieldOf(exact, 'ok'), false); assert.equal(fieldOf(exact, 'error.code'), 'PAYLOAD_LIMIT');
});

test('errors still come back as one JSON string', () => {
  const h = host();
  assert.equal(fieldOf(h.read({ compositionIds: [] }), 'error.code'), 'INVALID_REQUEST');
  assert.equal(fieldOf(parseJson(hostTextFunction(h.context, 'aeEyesOpenProbe')('{')), 'error.code'), 'INVALID_REQUEST');
});

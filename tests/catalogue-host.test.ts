/**
 * Tests the catalogue's ExtendScript host file: it parses as ES3 and guards the scratch project it adds effects
 * to.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { JsonValue } from '../packages/decode/dist/src/index.js';
import { catalogueHost } from './catalogue-fake-host.ts';
import type { CatalogueHost, EffectTable, InstanceRequest, ProbeRequest } from './catalogue-fake-host.ts';
import { parseCatalogueInstance, parseCataloguePage } from '../apps/sidecar/dist/src/catalogue-page.js';
import type { CatalogueInstanceRead, CataloguePage } from '../apps/sidecar/dist/src/catalogue-page.js';
import { hostText } from '../apps/panel/dist/tests/host-sources.js';
import { fieldOf, flagOf, numberOf, recordOf, recordsOf, textOf, textsOf } from '../apps/sidecar/dist/tests/http-json.js';
import type { JsonObject } from '../apps/sidecar/dist/tests/http-json.js';

const request = (overrides: Partial<ProbeRequest> = {}): ProbeRequest => ({
  schemaVersion: '0.1', requestId: 'req-1', matchNames: ['FX Blur'], ...overrides,
});
const effects = {
  'FX Blur': { name: 'Synthetic Blur', controls: [
    { m: 'FX Blur-0001', n: 'Blurriness', v: 10, min: 0, max: 100 },
    { m: 'FX Menu-0002', n: 'Quality', v: 2, items: ['Low', 'High'], vary: false },
    { m: 'FX Group', n: 'Group', children: [
      { m: 'FX Pos', n: 'Position', t: 'TwoD', v: [32, 32] },
      { m: 'FX Hidden', n: 'Hidden', v: 0, hidden: true },
      { m: 'FX Deep', n: 'Deep', children: [{ m: 'FX Color', n: 'Color', t: 'COLOR', v: [1, 0, 0, 1] }] },
    ] },
  ] },
  'FX Plain': { name: 'Plain', controls: [{ m: 'FX Plain-0001', n: 'Amount', v: 1 }] },
  'FX Third': { name: 'Third', controls: [] },
  'FX Unaddable': { unaddable: true },
  'FX Throws': { throws: true },
  'FX Stuck': { stuck: true, controls: [{ m: 'FX Stuck-0001', v: 1 }] },
} satisfies EffectTable;

const ES3_BANNED_SYNTAX: ReadonlyArray<readonly [string, RegExp]> = [
  ['let', /\blet\b/], ['const', /\bconst\b/], ['arrow', /=>/], ['template', /`/], ['forEach', /\.forEach\(/],
  ['map', /\.map\(/], ['filter', /\.filter\(/], ['reduce', /\.reduce\(/], ['some', /\.some\(/], ['every', /\.every\(/],
  ['arrayIsArray', /Array\.isArray/], ['objectKeys', /Object\.keys/], ['bind', /\.bind\(/], ['trim', /\.trim\(/],
  ['includes', /\.includes\(/], ['spread', /\.\.\./], ['trailingComma', /,\s*[}\]]/],
];

const picked = (row: JsonObject, keys: readonly string[]) => keys.map(key => fieldOf(row, key));
const itemNames = (host: CatalogueHost): string[] => host.items.map(item => item.name);
const errorCode = (reply: JsonValue): string => textOf(reply, 'error.code');
const outcomeCode = (outcome: { readonly kind: string }): string | undefined => ('code' in outcome ? textOf(outcome, 'code') : undefined);

function acceptedPage(page: JsonValue, matchNames: readonly string[]): CataloguePage {
  const parsed = parseCataloguePage(page, 'req-1', matchNames);
  if (parsed.kind !== 'page') throw new Error(`the sidecar refused the page: ${parsed.kind}`);
  return parsed.page;
}

function acceptedInstance(answer: JsonValue): CatalogueInstanceRead {
  const parsed = parseCatalogueInstance(answer, 'inst-1', 'FX Needs Source');
  if (parsed.kind !== 'instance') throw new Error(`the sidecar refused the instance: ${parsed.kind}`);
  return parsed.read;
}

function failureNamed(page: JsonValue, matchName: string): JsonObject {
  const found = recordsOf(page, 'failures').find(failure => textOf(failure, 'matchName') === matchName);
  if (!found) throw new Error(`no failure for ${matchName}`);
  return found;
}

test('host file is ES3: no let/const, arrows, array helpers, template strings or trailing commas', () => {
  const source = hostText('catalogue.jsx')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
  for (const [name, pattern] of ES3_BANNED_SYNTAX) assert.doesNotMatch(source, pattern, `ES3 violation: ${name}`);
  assert.doesNotMatch(source, /\.indexOf\(/, 'array indexOf is not ES3');
});

interface ForeignCase {
  readonly reason: string;
  readonly host: CatalogueHost;
  readonly prepare: (host: CatalogueHost) => void;
}

test('refuses with NOT_SCRATCH_PROJECT unless the project is untitled and holds nothing of the user', () => {
  const cases: readonly ForeignCase[] = [
    { reason: 'no-project', host: catalogueHost({ effects, noProject: true }), prepare: () => undefined },
    { reason: 'project-saved', host: catalogueHost({ effects, file: { name: 'Real.aep' } }), prepare: () => undefined },
    { reason: 'foreign-items', host: catalogueHost({ effects }), prepare: host => { host.userItem(); } },
  ];
  for (const { reason, host, prepare } of cases) {
    prepare(host);
    const before = host.log.projectMutations;
    const page = host.call(request());
    assert.equal(flagOf(page, 'ok'), false); assert.equal(errorCode(page), 'NOT_SCRATCH_PROJECT');
    assert.equal(textOf(page, 'error.reason'), reason); assert.equal(textOf(page, 'requestId'), 'req-1');
    assert.equal(host.log.projectMutations, before, `${reason}: nothing was created or removed`);
    assert.deepEqual(host.log.adds, []); assert.equal(host.log.suppress, 0);
    assert.equal(errorCode(host.call(request({ cleanup: true, matchNames: [] }))), 'NOT_SCRATCH_PROJECT', `${reason}: cleanup is refused too`);
  }
});

test('a page that saw user work removes only a leftover scratch folder that is entirely its own', () => {
  const host = catalogueHost({ effects });
  assert.equal(flagOf(host.call(request()), 'ok'), true);
  assert.deepEqual(host.items, []);
  host.userItem('Added by the user afterwards');
  assert.equal(textOf(host.call(request()), 'error.reason'), 'foreign-items');
  assert.deepEqual(itemNames(host), ['Added by the user afterwards']);
});

test('a user item next to our scratch folder makes the project foreign again', () => {
  const host = catalogueHost({ effects });
  assert.equal(flagOf(host.call(request()), 'ok'), true);
  assert.equal(flagOf(host.call(request()), 'ok'), true, 'scratch items alone are accepted on every later page');
  host.userItem('Added by the user afterwards');
  assert.equal(textOf(host.call(request()), 'error.reason'), 'foreign-items');
});

function assertBlurControls(controls: readonly JsonObject[]): void {
  const [blur, menu, grouped] = controls;
  assert.deepEqual(
    picked(recordOf(blur, ''), ['matchName', 'name', 'index', 'kind', 'valueType', 'defaultValue', 'hasMin', 'min', 'hasMax', 'max', 'isDropdown', 'items', 'canVary', 'hidden']),
    ['FX Blur-0001', 'Blurriness', 1, 'property', 'OneD', 10, true, 0, true, 100, false, null, true, false],
  );
  assert.deepEqual(picked(recordOf(menu, ''), ['isDropdown', 'items', 'canVary']), [true, ['Low', 'High'], false]);
  assert.equal(textOf(grouped, 'kind'), 'group'); assert.equal(numberOf(grouped, 'childCount'), 3);
  assert.deepEqual(
    recordsOf(grouped, 'children').map(child => picked(child, ['matchName', 'valueType', 'defaultValue', 'hidden'])),
    [['FX Pos', 'TwoD', [32, 32], false], ['FX Hidden', 'OneD', 0, true], ['FX Deep', undefined, undefined, undefined]],
  );
  assert.equal(textOf(grouped, 'children.2.children.0.valueType'), 'COLOR');
  assert.deepEqual(fieldOf(grouped, 'children.2.children.0.defaultValue'), [1, 0, 0, 1]);
}

test('first page builds the scratch folder, comp and solid; reads the full tree; removes the effect again', () => {
  const host = catalogueHost({ effects });
  const page = host.call(request());
  assert.equal(flagOf(page, 'ok'), true, JSON.stringify(page)); assert.deepEqual(fieldOf(page, 'host'), { version: '26.2', build: '2' });
  assert.deepEqual(fieldOf(page, 'failures'), []); assert.deepEqual(fieldOf(page, 'remaining'), []); assert.equal(typeof fieldOf(page, 'elapsedMs'), 'number');
  const result = recordOf(page, 'results.0');
  assert.equal(textOf(result, 'matchName'), 'FX Blur'); assert.equal(textOf(result, 'displayName'), 'Synthetic Blur');
  assert.equal(flagOf(result, 'truncated'), false);
  assertBlurControls(recordsOf(result, 'controls'));
  assert.deepEqual(host.log.adds, ['FX Blur']); assert.deepEqual(host.log.removes, ['FX Blur']); assert.equal(host.parade.numProperties, 0);
  assert.deepEqual(host.items, [], 'scratch folder, comp and solid (and AE\'s Solids folder) never outlive the page');
  assert.equal(parseCataloguePage(page, 'req-1', ['FX Blur']).kind, 'page', 'the sidecar accepts exactly this shape');
});

const unitsEffects = {
  'FX Units': { name: 'Units', controls: [
    { m: 'U-pixels', v: 1, min: 0, max: 200, units: 'pixels' },
    { m: 'U-padded', v: 1, units: '  degrees \n' },
    { m: 'U-long', v: 1, units: 'x'.repeat(120) },
    { m: 'U-absent', v: 1, min: 0, max: 1 },
    { m: 'U-empty', v: 1, units: '' },
    { m: 'U-blank', v: 1, units: '   ' },
    { m: 'U-number', v: 1, units: 7 },
    { m: 'U-null', v: 1, units: null },
    { m: 'U-throws', v: 1, units: { throws: true } },
    { m: 'U-group', children: [{ m: 'U-inner', v: 1, units: '%' }] },
  ] },
} satisfies EffectTable;

test('unitsText is collected as AE reports it: trimmed text, or null when AE reports none, empty text, non-text or throws', () => {
  const host = catalogueHost({ effects: unitsEffects });
  const page = host.call(request({ matchNames: ['FX Units'] }));
  assert.equal(flagOf(page, 'ok'), true, JSON.stringify(page));
  const rows = recordsOf(page, 'results.0.controls');
  assert.deepEqual(
    rows.slice(0, 9).map(row => picked(row, ['matchName', 'unitsText'])),
    [['U-pixels', 'pixels'], ['U-padded', 'degrees'], ['U-long', 'x'.repeat(80)], ['U-absent', null], ['U-empty', null], ['U-blank', null], ['U-number', null], ['U-null', null], ['U-throws', null]],
  );
  assert.equal(fieldOf(rows[9], 'unitsText'), undefined, 'a group has no units'); assert.equal(textOf(rows[9], 'children.0.unitsText'), '%');
  assert.deepEqual(picked(recordOf(rows[0], ''), ['hasMin', 'min', 'hasMax', 'max']), [true, 0, true, 200], 'a throwing or missing unitsText never disturbs the other facts');
  const parsed = parseCataloguePage(page, 'req-1', ['FX Units']);
  assert.equal(parsed.kind, 'page');
  assert.deepEqual(acceptedPage(page, ['FX Units']).results[0]?.controls.slice(0, 9).map(row => row.units), ['pixels', 'degrees', 'x'.repeat(80), null, null, null, null, null, null]);
});

test('every page is wrapped in one dialog-suppression pair and one undo group', () => {
  const host = catalogueHost({ effects });
  host.call(request({ matchNames: ['FX Blur', 'FX Plain'] })); host.call(request());
  assert.deepEqual([host.log.suppress, host.log.unsuppress, host.log.undoBegin, host.log.undoEnd], [2, 2, 2, 2]);
  const refusedAfterThrow = catalogueHost({ effects: { 'FX Throws': effects['FX Throws'] } });
  refusedAfterThrow.call(request({ matchNames: ['FX Throws'] }));
  const refusedLog = refusedAfterThrow.log;
  assert.deepEqual([refusedLog.suppress, refusedLog.unsuppress, refusedLog.undoBegin, refusedLog.undoEnd], [1, 1, 1, 1]);
});

test('unaddable, throwing and empty effects are reported per effect and never abort the page', () => {
  const host = catalogueHost({ effects });
  const page = host.call(request({ matchNames: ['FX Unaddable', 'FX Throws', 'FX Missing', 'FX Third', 'FX Plain'] }));
  assert.equal(flagOf(page, 'ok'), true);
  assert.deepEqual(fieldOf(page, 'failures'), [
    { matchName: 'FX Unaddable', code: 'CANNOT_ADD', detail: null, applyMs: null, createdItems: 0 },
    { matchName: 'FX Throws', code: 'ADD_FAILED', detail: 'Error: boom', applyMs: 0, createdItems: 0 },
    { matchName: 'FX Missing', code: 'CANNOT_ADD', detail: null, applyMs: null, createdItems: 0 },
  ]);
  assert.deepEqual(recordsOf(page, 'results').map(result => [textOf(result, 'matchName'), recordsOf(result, 'controls').length]), [['FX Third', 0], ['FX Plain', 1]]);
  assert.equal(host.parade.numProperties, 0);
});

test('an effect that cannot be removed stops the page and is reported so the sidecar can pause', () => {
  const host = catalogueHost({ effects });
  const page = host.call(request({ matchNames: ['FX Stuck', 'FX Plain'] }));
  assert.equal(flagOf(page, 'ok'), true);
  assert.deepEqual(fieldOf(page, 'failures'), [{ matchName: 'FX Stuck', code: 'REMOVE_FAILED' }]); assert.deepEqual(fieldOf(page, 'remaining'), ['FX Plain']);
  assert.equal(errorCode(host.call(request())), 'SETUP_FAILED', 'the next page refuses while the layer is not clean');
});

test('the time budget stops the page and hands back what is left; one effect is always processed', () => {
  const host = catalogueHost({ effects, addCostMs: 100 });
  const page = host.call(request({ matchNames: ['FX Plain', 'FX Blur', 'FX Third', 'FX Plain', 'FX Blur'], budgetMs: 200 }));
  assert.deepEqual(recordsOf(page, 'results').map(result => textOf(result, 'matchName')), ['FX Plain', 'FX Blur']);
  assert.deepEqual(fieldOf(page, 'remaining'), ['FX Third', 'FX Plain', 'FX Blur']);
  const tiny = catalogueHost({ effects, addCostMs: 500 }).call(request({ matchNames: ['FX Plain', 'FX Blur'], budgetMs: 1 }));
  assert.equal(recordsOf(tiny, 'results').length, 1, 'progress is guaranteed even when one effect exceeds the budget');
  assert.deepEqual(fieldOf(tiny, 'remaining'), ['FX Blur']);
  const capped = catalogueHost({ effects, addCostMs: 250 }).call(request({ matchNames: ['FX Plain', 'FX Blur', 'FX Third'], budgetMs: 5000 }));
  assert.equal(recordsOf(capped, 'results').length, 2, 'budgetMs is capped at 400 whatever the request asks for');
  assert.deepEqual(fieldOf(capped, 'remaining'), ['FX Third']);
});

test('an effect with hundreds of controls is read whole; only the 4096-row safety bound truncates', () => {
  const rows = (count: number): EffectTable => ({
    'FX Many': { controls: Array.from({ length: count }, (_, index) => ({ m: `P${index}`, v: index })) },
  });
  const whole = catalogueHost({ effects: rows(300) }).call(request({ matchNames: ['FX Many'] }));
  assert.equal(recordsOf(whole, 'results.0.controls').length, 300); assert.equal(flagOf(whole, 'results.0.truncated'), false);
  const bounded = catalogueHost({ effects: rows(4100) }).call(request({ matchNames: ['FX Many'] }));
  assert.equal(recordsOf(bounded, 'results.0.controls').length, 4096); assert.equal(flagOf(bounded, 'results.0.truncated'), true);
});

test('cleanup removes every scratch item and leaves an empty project; with nothing to clean it still succeeds', () => {
  const host = catalogueHost({ effects });
  host.call(request());
  const cleaned = host.call(request({ cleanup: true, matchNames: [] }));
  assert.equal(flagOf(cleaned, 'ok'), true); assert.equal(flagOf(cleaned, 'cleanedUp'), true); assert.equal(host.items.length, 0);
  assert.equal(flagOf(host.call(request({ cleanup: true, matchNames: [] })), 'cleanedUp'), true);
  assert.equal(flagOf(host.call(request()), 'ok'), true, 'a later page rebuilds the scratch project');
});

test('a hold page keeps only effects with a menu-like control applied, reports where, and cleanup then removes them', () => {
  const popup = { name: 'Glow', controls: [{ m: 'FX Glow-0001', n: 'Operation', v: 3, min: 1, max: 25 }] };
  const host = catalogueHost({ effects: { ...effects, 'FX Glow': popup } });
  const page = host.call(request({ hold: true, matchNames: ['FX Plain', 'FX Glow', 'FX Blur'] }));
  assert.equal(flagOf(page, 'ok'), true, JSON.stringify(page)); assert.deepEqual(fieldOf(page, 'failures'), []);
  assert.deepEqual(recordsOf(page, 'results').map(result => textOf(result, 'matchName')), ['FX Plain', 'FX Glow', 'FX Blur']);
  assert.deepEqual(textsOf(page, 'held.matchNames'), ['FX Glow', 'FX Blur']);
  assert.deepEqual([typeof fieldOf(page, 'held.compId'), textOf(page, 'held.layerId')], ['string', '7']);
  assert.deepEqual(host.log.removes, ['FX Plain']); assert.equal(host.parade.numProperties, 2);
  assert.ok(host.items.length > 0, 'the scratch project stays until the cleanup page');
  const cleaned = host.call(request({ cleanup: true, matchNames: [] }));
  assert.equal(flagOf(cleaned, 'cleanedUp'), true); assert.equal(host.items.length, 0);
  assert.equal(fieldOf(host.call(request()), 'held'), undefined, 'a page without hold never holds');
  assert.equal(flagOf(host.call(request({ hold: 'yes' })), 'ok'), false, 'hold must be a boolean');
});

test('malformed requests are refused before the project is looked at', () => {
  const host = catalogueHost({ effects });
  const bad: readonly ProbeRequest[] = [
    { ...request(), schemaVersion: '9' }, { ...request(), requestId: 'x'.repeat(129) },
    { ...request(), matchNames: Array.from({ length: 17 }, (_, i) => `FX ${i}`) },
    { ...request(), matchNames: [1] }, { ...request(), matchNames: [] }, { ...request(), budgetMs: 'fast' }, { ...request(), cleanup: 'yes' },
  ];
  for (const value of bad) assert.equal(errorCode(host.call(value)), 'INVALID_REQUEST', JSON.stringify(value).slice(0, 80));
  assert.equal(errorCode(host.raw('not json')), 'INVALID_REQUEST');
  assert.equal(host.items.length, 0); assert.deepEqual(host.log.adds, []);
});

test('items a plugin creates on apply are removed again and counted, so the next page still finds a scratch project', () => {
  const helper = { name: 'Helper', createsItems: 2, waitMs: 2500, controls: [{ m: 'FX Helper-0001', v: 1 }] };
  const host = catalogueHost({ effects: { ...effects, 'FX Helper': helper } });
  const page = host.call(request({ matchNames: ['FX Helper', 'FX Plain'] }));
  assert.equal(flagOf(page, 'ok'), true, JSON.stringify(page));
  assert.deepEqual(recordsOf(page, 'results').map(result => picked(result, ['matchName', 'applyMs', 'createdItems'])), [['FX Helper', 2500, 2]]);
  assert.deepEqual(fieldOf(page, 'remaining'), ['FX Plain'], 'the wait on a plugin window used up the page budget');
  assert.deepEqual(host.items, [], 'helper items, scratch folder, comp and solid are all gone');
  assert.equal(flagOf(host.call(request()), 'ok'), true, 'the next page is not refused as foreign-items');
  const accepted = acceptedPage(page, ['FX Helper', 'FX Plain']);
  assert.equal(accepted.results[0]?.applyMs, 2500); assert.equal(accepted.results[0]?.createdItems, 2);
});

test('with a breadcrumb path, the page records each effect before adding and before removing it, then done', () => {
  const host = catalogueHost({ effects });
  const breadcrumb = '/Users/someone/Library/Application Support/extynt/catalogue-probe-current.json';
  const page = host.call(request({ matchNames: ['FX Unaddable', 'FX Blur', 'FX Plain'], breadcrumb, budgetMs: 400 }));
  assert.equal(flagOf(page, 'ok'), true, JSON.stringify(page));
  assert.deepEqual(
    host.log.crumbs.map(crumb => [crumb.phase, crumb.matchName]),
    [['apply', 'FX Blur'], ['remove', 'FX Blur'], ['apply', 'FX Plain'], ['remove', 'FX Plain'], ['done', '']],
  );
  assert.ok(host.log.crumbs.every(crumb => crumb.path === breadcrumb && crumb.ticket === 'req-1'));
  for (const bad of ['/tmp/evil.json', '/Users/x/catalogue-probe-current.json.bak', 42]) {
    const before = host.log.crumbs.length;
    assert.equal(errorCode(host.call(request({ breadcrumb: bad }))), 'INVALID_REQUEST');
    assert.equal(host.log.crumbs.length, before, 'no file is written for a refused path');
  }
  const windows = catalogueHost({ effects });
  const windowsPath = 'C:\\Users\\x\\AppData\\Roaming\\extynt\\catalogue-probe-current.json';
  assert.equal(flagOf(windows.call(request({ breadcrumb: windowsPath })), 'ok'), true);
  assert.equal(flagOf(catalogueHost({ effects }).call(request()), 'ok'), true, 'without a breadcrumb nothing is written and the page still runs');
});

test('an add that throws or returns nothing keeps After Effects\' own words, bounded, as the failure detail', () => {
  const host = catalogueHost({ effects: {
    'FX Throws': { throws: true, throwsText: 'This effect requires a C4D file layer.\r\nSecond line' },
    'FX Silent': { returnsNothing: true },
    'FX Long': { throws: true, throwsText: 'x'.repeat(900) },
    'FX Plain': effects['FX Plain'],
  } });
  const names = ['FX Throws', 'FX Silent', 'FX Long', 'FX Plain'];
  const page = host.call(request({ matchNames: names }));
  assert.equal(textOf(failureNamed(page, 'FX Throws'), 'code'), 'ADD_FAILED');
  assert.equal(textOf(failureNamed(page, 'FX Throws'), 'detail'), 'Error: This effect requires a C4D file layer. Second line');
  assert.equal(textOf(failureNamed(page, 'FX Silent'), 'code'), 'ADD_FAILED');
  assert.equal(textOf(failureNamed(page, 'FX Silent'), 'detail'), 'addProperty returned nothing');
  assert.equal(textOf(failureNamed(page, 'FX Long'), 'detail').length, 300, 'the host bounds what it sends');
  assert.deepEqual(recordsOf(page, 'results').map(result => textOf(result, 'matchName')), ['FX Plain']);
  const parsed = parseCataloguePage(page, 'req-1', names);
  assert.equal(parsed.kind, 'page');
  assert.equal(acceptedPage(page, names).failures.find(failure => failure.matchName === 'FX Silent')?.detail, 'addProperty returned nothing');
});

const instanceRequest = (overrides: Partial<InstanceRequest> = {}): InstanceRequest => ({
  schemaVersion: '0.1', requestId: 'inst-1', matchName: 'FX Needs Source', compId: '', layerId: '77', effectIndex: 2, ...overrides,
});

function projectWithInstance() {
  const host = catalogueHost({ effects, file: { name: 'Real.aep' } });
  const comp = host.userItem('Main');
  host.userLayer(comp, 77, [
    { matchName: 'FX Plain', controls: [{ m: 'FX Plain-0001', n: 'Amount', v: 5 }] },
    { matchName: 'FX Needs Source', name: 'Needs Source', controls: [
      { m: 'FX NS-0001', n: 'Opacity', v: 80, min: 0, max: 100, units: '%' },
      { m: 'FX NS-0002', n: 'Mode', v: 2, items: ['A', 'B'] },
      { m: 'FX NS-Group', n: 'Group', children: [{ m: 'FX NS-Pos', n: 'Position', t: 'TwoD', v: [3, 4] }] },
    ] },
  ]);
  return { host, ask: (overrides: Partial<InstanceRequest> = {}) => host.readInstance(instanceRequest({ compId: String(comp.id), ...overrides })) };
}

test('reading a real instance returns its control tree in a saved project and changes nothing', () => {
  const { host, ask } = projectWithInstance();
  const before = { mutations: host.log.projectMutations, items: host.items.length };
  const answer = ask();
  assert.equal(flagOf(answer, 'ok'), true, JSON.stringify(answer)); assert.equal(textOf(answer, 'requestId'), 'inst-1');
  assert.equal(textOf(answer, 'instance.matchName'), 'FX Needs Source'); assert.equal(textOf(answer, 'instance.displayName'), 'Needs Source');
  assert.deepEqual(recordsOf(answer, 'instance.controls').map(row => textOf(row, 'matchName')), ['FX NS-0001', 'FX NS-0002', 'FX NS-Group']);
  assert.deepEqual(picked(recordOf(answer, 'instance.controls.0'), ['min', 'max', 'unitsText']), [0, 100, '%']);
  assert.deepEqual(fieldOf(answer, 'instance.controls.1.items'), ['A', 'B']);
  assert.equal(textOf(answer, 'instance.controls.2.children.0.matchName'), 'FX NS-Pos');
  assert.deepEqual(
    [host.log.adds, host.log.removes, host.log.undoBegin, host.log.undoEnd, host.log.suppress, host.log.crumbs.length],
    [[], [], 0, 0, 0, 0], 'no add, remove, undo group, dialog suppression or breadcrumb',
  );
  assert.deepEqual({ mutations: host.log.projectMutations, items: host.items.length }, before);
  assert.equal(acceptedInstance(answer).matchName, 'FX Needs Source');
  assert.equal(outcomeCode(parseCatalogueInstance(answer, 'other', 'FX Needs Source')), 'CATALOGUE_TICKET_MISMATCH');
  assert.equal(outcomeCode(parseCatalogueInstance(answer, 'inst-1', 'FX Plain')), 'CATALOGUE_PAGE_INVALID', 'an answer for another effect is not accepted');
});

test('the effect is verified by matchName at its position before anything is read; a moved project is reported, not read', () => {
  const { host, ask } = projectWithInstance();
  const mutations = host.log.projectMutations;
  const reads = [ask({ effectIndex: 1 }), ask({ matchName: 'FX Plain' }), ask({ effectIndex: 9 }), ask({ layerId: '999' }), ask({ compId: '424242' })];
  assert.deepEqual(
    reads.map(read => [flagOf(read, 'ok'), errorCode(read)]),
    [[false, 'EFFECT_MISMATCH'], [false, 'EFFECT_MISMATCH'], [false, 'EFFECT_NOT_FOUND'], [false, 'LAYER_NOT_FOUND'], [false, 'COMP_NOT_FOUND']],
  );
  assert.equal(outcomeCode(parseCatalogueInstance(reads[0] ?? null, 'inst-1', 'FX Needs Source')), 'EFFECT_MISMATCH');
  assert.equal(errorCode(catalogueHost({ effects, noProject: true }).readInstance(instanceRequest({ compId: '1' }))), 'NO_PROJECT');
  assert.deepEqual([host.log.projectMutations, host.log.adds, host.log.removes], [mutations, [], []], 'nothing was touched');
});

test('malformed instance requests are refused before the project is looked at', () => {
  const { host } = projectWithInstance();
  const bad: readonly Partial<InstanceRequest>[] = [
    { effectIndex: 0 }, { effectIndex: 1.5 }, { effectIndex: 'two' }, { matchName: '' }, { layerId: 5 }, { schemaVersion: '9' }, { requestId: '' },
  ];
  for (const overrides of bad) {
    const answer = host.readInstance(instanceRequest({ compId: '1', ...overrides }));
    assert.equal(flagOf(answer, 'ok'), false, JSON.stringify(overrides)); assert.equal(errorCode(answer), 'INVALID_REQUEST', JSON.stringify(overrides));
  }
  assert.equal(errorCode(host.rawInstance('not json')), 'INVALID_REQUEST');
});

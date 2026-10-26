/** Builders for catalogue tests: host census, group and property rows with the fields the host reports. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { TestContext } from 'node:test';
import { CatalogueCollector } from '../apps/sidecar/dist/src/catalogue-collector.js';
import type { CatalogueCollectorOptions, CatalogueMailboxItem } from '../apps/sidecar/dist/src/catalogue-collector-types.js';
import type { JsonObject, JsonValue } from '../packages/decode/dist/src/index.js';
import { textOf } from '../apps/sidecar/dist/tests/http-json.js';
import { ProjectGraphStore } from '../apps/sidecar/dist/src/project-graph-store.js';
import type { HostCensus } from '../apps/sidecar/dist/src/server-types.js';

export const HOST_KEY = 'After Effects:26.2:macOS';

export interface CensusOptions {
  readonly requestId?: string;
  readonly version?: string;
  readonly build?: string;
  readonly effectVersion?: string;
}

export interface PropertyRow {
  matchName: string;
  name: string;
  index: number;
  kind: 'property';
  valueType: string;
  defaultValue: JsonValue;
  hasMin: boolean;
  min: JsonValue;
  hasMax: boolean;
  max: JsonValue;
  isDropdown: boolean;
  items: string[] | null;
  canVary: boolean;
  canSetExpression: boolean;
  hidden: boolean;
  units?: string;
}

export type PropertyOverrides = Partial<PropertyRow>;

export interface GroupRow {
  matchName: string;
  name: string;
  index: number;
  kind: 'group';
  childCount: number;
  children: Array<PropertyRow | GroupRow>;
}

export type GroupOverrides = Partial<GroupRow>;
export type ControlRow = PropertyRow | GroupRow;

export interface EffectResult {
  matchName: string;
  displayName: string;
  controls: ControlRow[];
  truncated: boolean;
}

export interface HostFailure {
  readonly matchName: string;
  readonly code: string;
  readonly detail?: string;
}

export interface HostPage {
  schemaVersion: '0.1';
  ok: boolean;
  requestId: string;
  host: { version: string; build: string };
  results: EffectResult[];
  failures: HostFailure[];
  remaining: string[];
  elapsedMs: number;
}

export type HostPageOverrides = Partial<HostPage>;

export interface HarnessOptions {
  readonly enabled?: boolean;
  readonly plugins?: boolean;
  readonly withoutInstances?: boolean;
  readonly collector?: Partial<CatalogueCollectorOptions>;
}

export interface LoggedEvent extends JsonObject {
  event: string;
}

export interface CollectorHarness {
  readonly directory: string;
  readonly clock: { now: number };
  readonly events: LoggedEvent[];
  readonly graph: ProjectGraphStore;
  readonly collector: CatalogueCollector;
  land(names: readonly string[], censusOptions?: CensusOptions): HostCensus;
  restart(): void;
  database(): DatabaseSync;
}

export type PageItem = Extract<CatalogueMailboxItem, { hostFunction: 'aeCatalogueProbePage' }>;

export function requirePage(item: CatalogueMailboxItem | undefined): PageItem {
  if (item?.hostFunction !== 'aeCatalogueProbePage') throw new Error('expected a catalogue probe page');
  return item;
}

export function census(names: readonly string[], options: CensusOptions = {}): HostCensus {
  return { schemaVersion: '0.1', ok: true, requestId: options.requestId ?? 'census-1', warnings: [], result: {
    runtime: { application: 'After Effects', appVersion: options.version ?? '26.2', buildNumber: options.build ?? '2', buildName: null, platform: 'macOS', architecture: 'unknown', compatible: true },
    installedEffects: names.map(name => ({ matchName: name, displayName: `Display ${name}`, category: 'Synthetic', version: options.effectVersion ?? 'v1', available: true })),
    totalReported: names.length, returnedCount: names.length, completeness: 'complete' } };
}
export interface CensusChange {
  readonly runtime?: Partial<HostCensus['result']['runtime']>;
  readonly completeness?: HostCensus['result']['completeness'];
  readonly installedEffects?: HostCensus['result']['installedEffects'];
}

/** A copy of `base` with the change applied; replacing the effects keeps the reported counts equal to their number. */
export function censusWith(base: HostCensus, change: CensusChange): HostCensus {
  const installedEffects = change.installedEffects ?? base.result.installedEffects;
  const counts = change.installedEffects ? { totalReported: installedEffects.length, returnedCount: installedEffects.length } : {};
  const runtime = { ...base.result.runtime, ...change.runtime };
  return { ...base, result: { ...base.result, ...counts, installedEffects, completeness: change.completeness ?? base.result.completeness, runtime } };
}
export function prop(matchName: string, extra: PropertyOverrides = {}): PropertyRow {
  return { matchName, name: matchName, index: 1, kind: 'property', valueType: 'OneD', defaultValue: 1, hasMin: false, min: null, hasMax: false, max: null, isDropdown: false, items: null, canVary: true, canSetExpression: true, hidden: false, ...extra };
}
export function group(matchName: string, children: ControlRow[], extra: GroupOverrides = {}): GroupRow {
  return { matchName, name: matchName, index: 1, kind: 'group', childCount: children.length, children, ...extra };
}
export function effectResult(matchName: string, controls: ControlRow[] = [prop(`${matchName}-0001`)]): EffectResult {
  return { matchName, displayName: `Display ${matchName}`, controls, truncated: false };
}
export function hostPage(item: PageItem, overrides: HostPageOverrides = {}): HostPage {
  const asked = item.hostRequest.matchNames;
  return { schemaVersion: '0.1', ok: true, requestId: item.ticket, host: { version: '26.2', build: '2' }, results: asked.map(name => effectResult(name)), failures: [], remaining: [], elapsedMs: 40, ...overrides };
}

/** A real collector over a real host-catalogue graph in a temporary state directory; `restart()` is a sidecar restart that keeps the files. */
export function collectorHarness(t: TestContext, options: HarnessOptions = {}): CollectorHarness {
  const directory = mkdtempSync(join(tmpdir(), 'extynt-catalogue-'));
  const clock = { now: 1_000_000 }, events: LoggedEvent[] = [];
  let graph = new ProjectGraphStore(directory);
  const build = () => new CatalogueCollector({ directory, now: () => clock.now, enabled: options.enabled ?? true, newId: (() => { let n = 0; return () => `id${++n}`; })(), cooldownMs: 0,
    ...(options.plugins ? {} : { adobeNative: () => true }),
    log: (event, fields) => events.push({ event, ...fields }),
    store: {
      probedKeys: key => graph.catalogueProbedKeys(key),
      writeProbe: inputs => graph.writeCatalogueProbe(inputs),
      ...(options.withoutInstances ? {} : { writeInstance: input => graph.writeCatalogueInstance(input) }),
    },
    ...options.collector });
  let collector = build();
  t.after(() => { graph.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, clock, events, get graph() { return graph; }, get collector() { return collector; },
    land(names, censusOptions) {
      const value = census(names, censusOptions);
      graph.observeCensus(value, clock.now);
      collector.onCensus(value);
      return value;
    },
    restart() { graph.close(); graph = new ProjectGraphStore(directory); collector = build(); },
    database() { const db = new DatabaseSync(textOf(graph.status(), 'catalogue.path')); t.after(() => db.close()); return db; } };
}

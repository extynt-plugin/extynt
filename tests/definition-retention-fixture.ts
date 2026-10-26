/** Fixtures for the definition retention tests: blur pages, census rows, SQLite readers and a seeded store. */
import { jsonOf } from '../packages/mcp-server/dist/src/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue, SQLOutputValue } from 'node:sqlite';
import { array, boolean, jsonValue, number, object, string, decodeOrThrow } from '../packages/decode/dist/src/index.js';
import type { Infer } from '../packages/decode/dist/src/index.js';
import { GraphStore } from '../apps/sidecar/dist/src/graph-store.js';
import type { JsonObject } from '../packages/decode/dist/src/index.js';
import type { HostCensus } from '../apps/sidecar/dist/src/server-types.js';

export type DatabaseRow = Readonly<Record<string, SQLOutputValue>>;

export interface BlurLayer { id: string; index: number; name?: string; selected?: boolean }
export interface BlurPage {
  project: { name: string; filePath: string };
  runtime: { application: string; appVersion: string; platform: string };
  stamp: { epoch: number; revision: number };
  sessionId: string;
  rows: JsonObject[];
  metadata: { composition: { id: string; itemIndex: number }; layer: BlurLayer };
  localEffect: {
    effectIndex: number; effectMatchName: string; effectEnabled: boolean; value: number; minimum: number; maximum: number;
    keyframeCount: number; expressionEnabled: boolean; expression: string; isTimeVarying: boolean; canSetValue: boolean;
    propertyIndices: number[];
  };
}

const controlRow = object({
  state: string(), controlInstanceId: number(), observationId: string(), observedAt: number(),
  stamp: object({ epoch: number(), revision: number() }), current: object({ value: jsonValue }),
  writeAuthorizing: boolean(), coverage: object({ absentOutsidePage: string() }),
});
const controlRows = array(controlRow);

export type ControlRow = Infer<typeof controlRow>;

export interface RetentionFixture {
  readonly path: string;
  readonly store: GraphStore;
  observe(at: number, layerId?: string): JsonObject;
  database(): DatabaseSync;
  controls(at: number, layerId?: string): ReadonlyArray<ControlRow>;
  firstControl(at: number, layerId?: string): ControlRow;
}

export const GAUSSIAN_BLUR = {
  matchName: 'ADBE Gaussian Blur 2', displayName: 'Gaussian Blur', category: 'Blur & Sharpen', version: 'fixture-1', available: true,
};

export function column(row: DatabaseRow, name: string): SQLOutputValue {
  const found = row[name];
  if (found === undefined) throw new Error(`no column ${name}`);
  return found;
}

export function oneRow(database: DatabaseSync, sql: string, ...parameters: SQLInputValue[]): DatabaseRow {
  const row = database.prepare(sql).get(...parameters);
  if (row === undefined) throw new Error(`no row for ${sql}`);
  return row;
}

export function scalar(database: DatabaseSync, sql: string, ...parameters: SQLInputValue[]): SQLOutputValue {
  const [first] = Object.values(oneRow(database, sql, ...parameters));
  if (first === undefined) throw new Error(`no column for ${sql}`);
  return first;
}

export function countRows(database: DatabaseSync, table: string): number {
  return Number(scalar(database, `SELECT count(*) AS n FROM ${table}`));
}

export function blurPage(at: number, layerId = 'layer-1'): BlurPage {
  return {
    project: { name: 'Retention.aep', filePath: '/synthetic/Retention.aep' },
    runtime: { application: 'After Effects', appVersion: '26.2', platform: 'macOS' },
    stamp: { epoch: 1, revision: 4 }, sessionId: `collection-${at}`, rows: [],
    metadata: { composition: { id: 'comp-1', itemIndex: 1 }, layer: { id: layerId, index: 1 } },
    localEffect: { effectIndex: 1, effectMatchName: 'ADBE Gaussian Blur 2', effectEnabled: true,
      value: 4, minimum: 0, maximum: 500, keyframeCount: 0, expressionEnabled: false,
      expression: '', isTimeVarying: false, canSetValue: true, propertyIndices: [1, 1, 1] },
  };
}

export function retentionFixture(t: TestContext): RetentionFixture {
  const directory = mkdtempSync(join(tmpdir(), 'extynt-retention-'));
  const path = join(directory, 'project.extynt'), store = new GraphStore(path);
  const databases: DatabaseSync[] = [];
  t.after(() => { databases.forEach(db => db.close()); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const controls = (at: number, layerId = 'layer-1'): ReadonlyArray<ControlRow> => decodeOrThrow(controlRows,
    store.queryRelational({ kind: 'controls', compositionId: 'comp-1', layerId }, at).rows);
  return { path, store,
    observe(at, layerId) { return store.observe({ kind: 'blur' }, jsonOf(blurPage(at, layerId)), 'panel-1', at); },
    database() { const db = new DatabaseSync(path); databases.push(db); return db; },
    controls,
    firstControl(at, layerId) {
      const [first] = controls(at, layerId);
      if (first === undefined) throw new Error('no control observed');
      return first;
    },
  };
}

export function censusFixture(): HostCensus {
  return { schemaVersion: '0.1', ok: true, requestId: 'census-fixture', warnings: [],
    result: { runtime: { application: 'After Effects', appVersion: '26.2', buildNumber: null, buildName: null, platform: 'macOS',
      architecture: 'arm64', compatible: true },
    installedEffects: [GAUSSIAN_BLUR], totalReported: 1, returnedCount: 1, completeness: 'complete' } };
}

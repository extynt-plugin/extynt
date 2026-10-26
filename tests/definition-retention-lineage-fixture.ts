/** Real GraphStore requests and SQLite images for definition-retention lineage tests. */
import { jsonOf } from '../packages/mcp-server/dist/src/index.js';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { DatabaseSync } from 'node:sqlite';
import type { JsonObject } from '../packages/decode/dist/src/index.js';
import type { VerifiedReadbackInput } from '../apps/sidecar/dist/src/graph-control-types.js';
import { fieldOf } from '../apps/sidecar/dist/tests/http-json.js';
import { blurPage, column, oneRow, retentionFixture } from './definition-retention-fixture.ts';
import type { BlurPage, ControlRow, DatabaseRow, RetentionFixture } from './definition-retention-fixture.ts';

export const DIGEST = 'a'.repeat(64);

export interface LineageOptions { layerId?: string; revision?: number; value?: number }
export interface DefinitionHistory { sources: DatabaseRow[]; facts: DatabaseRow[] }
export interface DesiredLineage { request: DatabaseRow; components: DatabaseRow[] }
export interface LineageFixture extends Omit<RetentionFixture, 'observe'> {
  observe(at: number, options?: LineageOptions): JsonObject;
  readonly db: DatabaseSync;
  readonly control: ControlRow;
  readonly history: DefinitionHistory;
  prepare(planId: string, at?: number): JsonObject;
  bind(planId: string, at?: number): JsonObject;
  repeat(options?: LineageOptions, first?: number, last?: number): void;
  proof(planId: string): VerifiedReadbackInput;
}

export function lineagePage(at: number, options: LineageOptions = {}): BlurPage {
  const { layerId = 'layer-1', revision = 4, value = 4 } = options;
  const page = blurPage(at, layerId);
  return { ...page, stamp: { epoch: 1, revision },
    metadata: { ...page.metadata, layer: { ...page.metadata.layer, name: layerId, selected: false } },
    localEffect: { ...page.localEffect, value } };
}

export function definitionHistory(database: DatabaseSync, observedAt = 1): DefinitionHistory {
  return {
    sources: database.prepare('SELECT * FROM definition_sources WHERE observed_at=? ORDER BY id').all(observedAt),
    facts: database.prepare(`SELECT f.* FROM parameter_definition_facts f JOIN definition_sources s ON s.id=f.provenance_id
      WHERE s.observed_at=? ORDER BY f.parameter_definition_id,f.provenance_id`).all(observedAt),
  };
}

export function desiredLineage(database: DatabaseSync, planId: string): DesiredLineage {
  return {
    request: oneRow(database, 'SELECT * FROM desired_control_requests WHERE plan_id=?', planId),
    components: database.prepare('SELECT * FROM desired_control_components WHERE plan_id=? ORDER BY component').all(planId),
  };
}

export function databaseImage(database: DatabaseSync): Array<{ table: string; rows: DatabaseRow[] }> {
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return tables.map(row => {
    const name = String(column(row, 'name'));
    return { table: name, rows: database.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid').all() };
  });
}

export function readbackProof(planId: string, observationId: string): VerifiedReadbackInput {
  const page = lineagePage(21, { revision: 5, value: 20 });
  const readback = { ...page, planId, readSetDigest: DIGEST, complete: true,
    rows: [{ operationIndex: 0, compositionId: 'comp-1', layerId: 'layer-1', layerIndex: 1,
      name: page.metadata.layer.name, locked: false, selected: false, value: 20 }] };
  return { planId, ticket: `native-${planId}`, readSetDigest: DIGEST, panelInstanceId: 'panel-1',
    sourceObservationId: observationId, receiptReference: `native-receipt/${planId}`, readback: jsonOf(readback) };
}

export function lineageFixture(t: TestContext): LineageFixture {
  const fixture = retentionFixture(t);
  const observe = (at: number, options?: LineageOptions): JsonObject => fixture.store.observe({ kind: 'blur' }, jsonOf(lineagePage(at, options)), 'panel-1', at);
  assert.equal(fieldOf(observe(1), 'state'), 'ready');
  const database = fixture.database(), control = fixture.firstControl(2);
  assert.equal(control.state, 'observed');
  const history = definitionHistory(database);
  assert.equal(history.sources.length, 2); assert.equal(history.facts.length, 1);
  return { ...fixture, observe, db: database, control, history,
    prepare(planId, at = 2) {
      return fixture.store.recordDesiredParameter({ planId, controlInstanceId: control.controlInstanceId,
        sourceObservationId: control.observationId, value: 20 }, at);
    },
    bind(planId, at = 3) {
      return fixture.store.bindDesiredApply({ planId, ticket: `native-${planId}`, readSetDigest: DIGEST,
        panelInstanceId: 'panel-1', stamp: control.stamp, sourceObservationId: control.observationId,
        controlInstanceId: control.controlInstanceId }, at);
    },
    repeat(options = {}, first = 4, last = 20) {
      for (let at = first; at <= last; at++) assert.equal(fieldOf(observe(at, options), 'state'), 'ready');
    },
    proof(planId) { return readbackProof(planId, control.observationId); },
  };
}

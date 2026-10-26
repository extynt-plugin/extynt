// The relational parameter tool: an external client's number for an observed effect control is admitted only against the exact observation it names, and each stale or mismatched observation is refused with its own code.
import assert from 'node:assert/strict';
import test from 'node:test';
import { bindApproval, computePlanDigest, issueApproval, type ActionPlan } from '@extynt/action-plan';
import { present } from './present.js';
import { compileCommand } from '@extynt/host-ae';
import type { LocalBlurObservation, ProjectSnapshot } from '@extynt/project-graph';
import { agentToolDefinitions, listTools, type ToolContext } from '@extynt/mcp-server';
import { parseParameterChange, parseRelationalQuery } from '../src/relational-arguments.js';
import { prepareParameterChange } from '../src/relational-parameter.js';
import { runExternalParameterTool, runPanelParameterTool } from '../src/relational-routing.js';
import { normalizeProbeSnapshot } from '../src/server-normalize.js';
import { mutableSnapshot } from './sidecar-fixture.js';

const NOW = 10000;
const PATH = 'ADBE Effect Parade/ADBE Gaussian Blur 2';
function withoutCoverage(value: ProjectSnapshot): ProjectSnapshot {
  const { coverage: _coverage, ...rest } = value;
  return rest;
}

function snapshot(units?: string): ProjectSnapshot {
  const base = normalizeProbeSnapshot(mutableSnapshot('parameter-native'), '2026-10-01T12:00:00Z');
  const local: LocalBlurObservation = { effectMatchName: 'ADBE Gaussian Blur 2', effectIndex: 1, inventory: [{ index: 1, matchName: 'ADBE Gaussian Blur 2' }], effectEnabled: true, matchNames: ['ADBE Effect Parade', 'ADBE Gaussian Blur 2', 'ADBE Gaussian Blur 2-0001'], valueType: 'number', canSetValue: true, keyframeCount: 0, expressionEnabled: false, expression: '', value: 4, minimum: 0, maximum: 500, dependencyPolicy: 'local-literal-assignment', ...(units === undefined ? {} : { unitsText: units }) };
  const coverage: NonNullable<ProjectSnapshot['coverage']> = { kind: 'composition-metadata', compositionId: 'comp-1', properties: 'unknown', otherCompositions: 'unknown', localEffect: local, collectionSessionId: 'collect-1' };
  return { ...base, hostStamp: { epoch: 1, revision: 4 }, coverage, compositions: base.compositions.map(composition => ({ ...composition, itemIndex: 300 })) };
}
function noUnits(): string | null {
  return null;
}
function current() {
  return { state: 'observed', controlInstanceId: 12, observationId: 'observation-12', panelInstanceId: 'panel-1', collectionSessionId: 'collect-1', observedAt: NOW, stamp: { epoch: 1, revision: 4 }, address: { compositionId: 'comp-1', layerId: 'layer-1', itemIndex: 300, layerIndex: 1, effectIndex: 1, effectMatchName: 'ADBE Gaussian Blur 2', controlMatchName: 'ADBE Gaussian Blur 2-0001', propertyPath: PATH + '/ADBE Gaussian Blur 2-0001' }, current: { valueType: 'OneD', value: 4, minimum: 0, maximum: 500, units: noUnits(), canSetValue: true, keyframeCount: 0, isTimeVarying: false, expressionEnabled: false, expressionPresent: false } };
}
const REQUEST = { controlInstanceId: 12, observationId: 'observation-12', value: { kind: 'number' as const, value: 20 } };
function admission(overrides: Partial<Parameters<typeof prepareParameterChange>[0]> = {}) {
  return prepareParameterChange({ request: REQUEST, current: current(), snapshot: snapshot(), panelInstanceId: 'panel-1', now: NOW, ...overrides });
}
test('an exact typed parameter request compiles through the approval-bound Gaussian read set', () => {
  const accepted = admission(); assert.equal(accepted.ok, true, JSON.stringify(accepted)); if (!accepted.ok) return;
  const native = snapshot();
  const plan: ActionPlan = { schemaVersion: '0.2', planId: 'parameter-1', snapshotFingerprint: native.fingerprint, selectionFingerprint: native.selectionFingerprint, freshness: native.freshness, summary: accepted.summary, operations: accepted.operations, requiresApproval: true, bounds: { maxOperations: 1 }, preconditions: [], conflicts: [], postconditions: [] };
  plan.digest = computePlanDigest(plan);
  const capability = issueApproval({ plan, snapshot: native, panelSessionId: 'panel-session', now: '2026-10-01T12:00:00Z' }); assert.ok('token' in capability); if (!('token' in capability)) return;
  const bound = bindApproval(plan, native, capability, '2026-10-01T12:00:01Z'); assert.ok('approvalId' in bound); if (!('approvalId' in bound)) return;
  const command = compileCommand(plan, native, bound); assert.ok('operation' in command); if (!('operation' in command)) return;
  assert.equal(command.operation, 'apply_plan'); if (command.operation !== 'apply_plan') return;
  assert.equal(command.readSet?.schemaVersion, 'blur-control-read-set/1');
  assert.equal(command.readSet?.digest, capability.readSetDigest);
  assert.deepEqual(command.operations, [{ operation: 'set_effect_control', compositionId: 'comp-1', layerId: 'layer-1', effectMatchName: 'ADBE Gaussian Blur 2', effectPath: PATH, propertyPath: PATH + '/ADBE Gaussian Blur 2-0001', value: 20 }]);
  assert.equal(admission({ snapshot: { ...native, hostStamp: { epoch: 1, revision: 5 } } }).ok, false);
});
const REFUSALS: Array<{ code: string; modify(row: ReturnType<typeof current>): ReturnType<typeof current> }> = [
  { code: 'STALE_PARAMETER_OBSERVATION', modify: row => ({ ...row, state: 'stale' }) },
  { code: 'STALE_PARAMETER_OBSERVATION', modify: row => ({ ...row, observedAt: NOW + 1 }) },
  { code: 'STALE_PARAMETER_OBSERVATION', modify: row => ({ ...row, observedAt: NOW - 15000 }) },
  { code: 'PARAMETER_SESSION_MISMATCH', modify: row => ({ ...row, panelInstanceId: 'another-panel' }) },
  { code: 'PARAMETER_SESSION_MISMATCH', modify: row => ({ ...row, collectionSessionId: '' }) },
  { code: 'PARAMETER_SESSION_MISMATCH', modify: row => ({ ...row, collectionSessionId: 'another-native-demand' }) },
  { code: 'PARAMETER_REVISION_MISMATCH', modify: row => ({ ...row, stamp: { epoch: 2, revision: 4 } }) },
  { code: 'PARAMETER_WRITE_UNSUPPORTED', modify: row => ({ ...row, address: { ...row.address, effectMatchName: 'Vendor Plugin' } }) },
  { code: 'PARAMETER_TARGET_MISMATCH', modify: row => ({ ...row, address: { ...row.address, layerIndex: 2 } }) },
  { code: 'PARAMETER_STATIC_POLICY', modify: row => ({ ...row, current: { ...row.current, expressionPresent: true } }) },
  { code: 'PARAMETER_STATIC_POLICY', modify: row => ({ ...row, current: { ...row.current, keyframeCount: 2 } }) },
  { code: 'PARAMETER_OBSERVATION_MISMATCH', modify: row => ({ ...row, current: { ...row.current, value: 5 } }) },
];
for (const refusal of REFUSALS) test('typed parameter admission refuses ' + refusal.code + ' without an operation', () => {
  const result = admission({ current: refusal.modify(current()) }); assert.equal(result.ok, false); if (result.ok) return;
  assert.equal(result.error.code, refusal.code); assert.equal('operations' in result, false);
});
test('unknown units, conversions, vectors and unbounded SQL fields are explicitly refused', () => {
  assert.equal(admission({ request: { ...REQUEST, value: { kind: 'number', value: 20, unit: '%' } } }).ok, false);
  assert.equal(admission({ request: { ...REQUEST, value: { kind: 'number', value: 501 } } }).ok, false);
  assert.ok('error' in parseParameterChange({ ...REQUEST, value: { kind: 'vector', value: [20, 30] } }));
  assert.ok('error' in parseParameterChange({ ...REQUEST, jsx: 'model-authored-script' }));
  assert.ok('error' in parseRelationalQuery({ query: { kind: 'controls', compositionId: 'comp-1', layerId: 'layer-1', sql: 'SELECT 1' } }));
  assert.ok('value' in parseRelationalQuery({ query: { kind: 'controls', compositionId: 'comp-1', layerId: 'layer-1' }, waitSeconds: 0 }));
  assert.ok('error' in parseRelationalQuery({ query: { kind: 'parameter-facts', parameterDefinitionId: 'parameter', limit: 26 } }));
});
test('scoped coverage must identify the exact requested native target', () => {
  const native = snapshot(); assert.ok(native.coverage);
  const wrong = admission({ snapshot: { ...native, coverage: { ...native.coverage, compositionId: 'another-composition' } } });
  assert.equal(wrong.ok, false); if (!wrong.ok) assert.equal(wrong.error.code, 'PARAMETER_COVERAGE_MISMATCH');
  const omitted = admission({ snapshot: { ...native, coverage: { ...native.coverage, observedLayerIds: ['another-layer'] } } });
  assert.equal(omitted.ok, false); if (!omitted.ok) assert.equal(omitted.error.code, 'PARAMETER_COVERAGE_MISMATCH');
});
test('matching explicit native units remain a literal value and scoped evidence is mandatory', () => {
  const observed = current(); observed.current.units = 'native-unit';
  const result = admission({ current: observed, snapshot: snapshot('native-unit'), request: { ...REQUEST, value: { kind: 'number', value: 20, unit: 'native-unit' } } });
  assert.equal(result.ok, true); if (result.ok) assert.equal(result.operations[0].value, 20);
  assert.equal(admission({ snapshot: withoutCoverage(snapshot()) }).ok, false);
  const mismatch = admission({ current: observed, snapshot: snapshot('different-unit') });
  assert.equal(mismatch.ok, false); if (!mismatch.ok) assert.equal(mismatch.error.code, 'PARAMETER_OBSERVATION_MISMATCH');
});
function deps(retain: boolean) {
  return { collection: { invalidateDesired() { return { state: 'invalidated' }; }, queryRelational() { return {}; }, resolveParameter() { return current(); }, recordDesiredParameter() { return retain ? { state: 'prepared' } : { state: 'unknown' }; } }, snapshot: snapshot(), panelInstanceId: 'panel-1', now: NOW };
}
test('failed desired persistence rolls back only the newly authored unapproved proposal', async () => {
  const context: ToolContext = { snapshot: snapshot(), plans: new Map(), panelSessionId: 'panel-session' };
  const refused = await runExternalParameterTool(deps(false), REQUEST, context);
  assert.equal(refused.ok, false); assert.equal(context.plans?.size, 0);
  const accepted = await runExternalParameterTool(deps(true), REQUEST, context);
  assert.equal(accepted.ok, true, JSON.stringify(accepted)); assert.equal(context.plans?.size, 1);
  const stored = present([...context.plans.values()][0], 'the stored plan');
  assert.equal(stored.status, 'prepared');
  assert.deepEqual(stored.relationalParameter, { controlInstanceId: REQUEST.controlInstanceId, sourceObservationId: REQUEST.observationId });
});
test('panel parameter staging preserves a populated queue and never calls its author', async () => {
  let called = false;
  const context: ToolContext = { snapshot: snapshot(), plans: new Map(), queue: { planId: 'prior-user-work', set() { throw Error('Existing queue must remain'); } } };
  const result = await runPanelParameterTool({ ...deps(true), queuedPlanId: () => 'prior-user-work' }, REQUEST, context, async () => { called = true; throw Error('Cannot author'); });
  assert.equal(result.ok, false); assert.equal(called, false); assert.equal(context.queue?.planId, 'prior-user-work');
});
test('failed desired persistence drops a new panel draft before any seal or native dispatch', async () => {
  let queued = '', calls = 0;
  const context: ToolContext = { snapshot: snapshot(), plans: new Map(), queue: { planId: null, set(value) { queued = value ?? ''; } } };
  const result = await runPanelParameterTool({ ...deps(false), queuedPlanId: () => queued }, REQUEST, context, async args => {
    calls += 1;
    const { callTool } = await import('@extynt/mcp-server');
    return callTool('ae_queue_add', args, context);
  });
  assert.equal(result.ok, false); assert.equal(calls, 1); assert.equal(queued, ''); assert.equal(context.plans?.size, 0);
});
test('the in-panel agent and the full catalogue carry typed query/proposal tools with distinct authority annotations; external clients are not listed them', () => {
  assert.equal(listTools('agent').some(tool => tool.name === 'ae_query_relational_graph' || tool.name === 'ae_prepare_parameter_change'), false);
  for (const definitions of [listTools('all'), agentToolDefinitions()]) {
    assert.equal(definitions.find(tool => tool.name === 'ae_query_relational_graph')?.annotations.readOnlyHint, true);
    const prepare = definitions.find(tool => tool.name === 'ae_prepare_parameter_change');
    assert.equal(prepare?.annotations.readOnlyHint, undefined); assert.equal(prepare?.planCard, true);
  }
});

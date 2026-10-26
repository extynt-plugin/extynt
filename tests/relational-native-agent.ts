// What an external agent does against the rig: demand bounded graph pages through the lane, query typed controls, prepare and approve a parameter change.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';
import type { TestContext } from 'node:test';
import { fieldOf, numberAt, recordAt, recordsAt, textAt } from '../apps/panel/dist/tests/json-narrow.js';
import type { Found } from '../apps/panel/dist/tests/json-narrow.js';
import type { StoredPlan } from '../packages/mcp-server/dist/src/index.js';
import { decodeOrThrow, nullable, number, object, string } from '../packages/decode/dist/src/index.js';
import type { Infer, JsonObject, JsonValue } from '../packages/decode/dist/src/index.js';
import { startRig, until } from './relational-native-rig.ts';
import type { Rig, RigCompletion, RigOptions, ToolArguments, ToolReply } from './relational-native-rig.ts';

const desiredRow = object({
  status: string(),
  source_observation_id: nullable(string()),
  verified_observation_id: nullable(string()),
  receipt_reference: nullable(string()),
  ticket: nullable(string()),
  read_set_digest: nullable(string()),
  verified_epoch: nullable(number()),
  verified_revision: nullable(number()),
});

/** The stored desired-request row of a plan, as SQLite holds it. */
export type DesiredEvidence = Infer<typeof desiredRow>;

/** A bounded page the agent demanded: `native` is the page the plugin answered, `observed` what the agent reads back. */
export interface AgentPage {
  readonly native: JsonValue | undefined;
  readonly observed: Found;
  readonly completed: RigCompletion;
  readonly jobId: Found;
}

/** A prepared parameter change awaiting approval. */
export interface Proposal {
  readonly planId: string;
}

/** The first row of an observed control page. */
export interface ObservedControl {
  readonly control: JsonObject;
}

/** Demands one bounded page and waits until the lane has run it. */
export async function agentPage(rig: Rig, args: ToolArguments): Promise<AgentPage> {
  const demand = await rig.tool('ae_read_graph_page', args);
  assert.equal(demand.status, 200, JSON.stringify(demand.body));
  assert.equal(fieldOf(demand.body, 'data', 'state'), 'pending');
  const demandId = textAt(demand.body, 'data', 'demandId');
  await until(() => fieldOf(rig.sidecar.collection.demandResult(demandId), 'state') !== 'pending');
  await rig.quiet();
  const observed = fieldOf((await rig.tool('ae_get_graph_page', { demandId })).body, 'data');
  const native = rig.calls.find(call => call.args.requestId === demandId)?.result;
  const completed = rig.completions.find(entry => entry.ticket === demandId);
  assert.ok(completed, 'the lane completed the demanded ticket');
  return { native, observed, completed, jobId: fieldOf(completed.body, 'jobId') ?? fieldOf(observed, 'continuation', 'jobId') };
}

/** Queries the controls of the title layer, narrowed by `filters`, and returns the page after checking it authorizes no write. */
export async function controlPage(rig: Rig, filters: ToolArguments = {}): Promise<JsonObject> {
  const result = await rig.tool('ae_query_relational_graph', { query: { kind: 'controls', compositionId: rig.host.comp.id, layerId: rig.host.title.id, ...filters } });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(fieldOf(result.body, 'data', 'writeAuthorizing'), false);
  return recordAt(result.body, 'data');
}

/** The first row of a control page. */
export function firstControl(page: JsonValue): JsonObject {
  const [first] = recordsAt(page, 'rows');
  if (first === undefined) throw new Error('the control page has no rows');
  return first;
}

export async function blurObservation(rig: Rig): Promise<ObservedControl> {
  const result = await agentPage(rig, { target: { ...rig.host.target('blur'), expectedStamp: rig.host.stamp() }, limit: 1 });
  assert.equal(result.completed.status, 200, JSON.stringify(result.completed.body));
  const page = await controlPage(rig, { effectMatchName: 'ADBE Gaussian Blur 2', controlMatchName: 'ADBE Gaussian Blur 2-0001', limit: 1 });
  assert.equal(recordsAt(page, 'rows').length, 1);
  return { control: firstControl(page) };
}

/** Prepares a bounded Blurriness change through the typed parameter tool. */
export async function parameterProposal(rig: Rig, control: JsonObject, value = 8): Promise<Proposal> {
  const result = await rig.tool('ae_prepare_parameter_change', {
    controlInstanceId: control.controlInstanceId, observationId: control.observationId,
    value: { kind: 'number', value }, summary: 'Set bounded Gaussian Blurriness',
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(fieldOf(result.body, 'ok'), true);
  assert.equal(fieldOf(result.body, 'data', 'writeAuthorizing'), false);
  return { planId: textAt(result.body, 'data', 'planId') };
}

/** Approves the way the panel's Apply does; the lane then runs the plan against the plugin. */
export async function approveParameter(rig: Rig, proposal: Proposal): Promise<ToolReply> {
  const result = await rig.tool('ae_approve_plan', { planId: proposal.planId, acknowledgeUnverified: true });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result;
}

/** Waits until the lane has settled the plan's apply: a receipt is recorded and nothing is left running. */
export async function appliedPlan(rig: Rig, planId: string): Promise<StoredPlan> {
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
  await rig.quiet();
  const plan = rig.sidecar.plans.get(planId);
  if (plan === undefined) throw new Error(`plan ${planId} is gone`);
  return plan;
}

/** The path of the SQLite file the sidecar's collection store writes. */
export function storagePath(rig: Rig): string {
  return textAt(rig.sidecar.collection.storageStatus(), 'path');
}

/** The number in one column of the first row a query returns. */
export function sqlNumber(database: DatabaseSync, query: string, column: string, ...parameters: SQLInputValue[]): number {
  const row = database.prepare(query).get(...parameters);
  if (row === undefined) throw new Error(`no row for ${query}`);
  return numberAt(decodeOrThrow(object({ [column]: number() }), row), column);
}

/** The desired-request row stored for a plan. */
export function desiredEvidence(rig: Rig, planId: string): DesiredEvidence {
  const database = new DatabaseSync(storagePath(rig), { readOnly: true });
  try {
    const columns = 'status,source_observation_id,verified_observation_id,receipt_reference,ticket,read_set_digest,verified_epoch,verified_revision';
    return decodeOrThrow(desiredRow, database.prepare(`SELECT ${columns} FROM desired_control_requests WHERE plan_id=?`).get(planId));
  } finally { database.close(); }
}

/** A started rig that has also read the composition's layer inventory, as the first demand of every relational scenario. */
export async function relationalRig(t: TestContext, options: RigOptions = {}): Promise<Rig> {
  const rig = await startRig(t, options);
  const inventory = await agentPage(rig, { target: { kind: 'layers', itemIndex: 1, compositionId: rig.host.comp.id }, limit: 25 });
  assert.equal(inventory.completed.status, 200, JSON.stringify(inventory.completed.body));
  return rig;
}

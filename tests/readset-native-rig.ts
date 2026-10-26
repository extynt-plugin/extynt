// A real native-lane sidecar on the fake plugin, with a vm-simulated project behind the plugin's host entries.
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { HostEntry } from '../packages/host-native/dist/src/index.js';
import { decodeOrThrow, jsonObject } from '../packages/decode/dist/src/index.js';
import { ok } from '../tools/fake-plugin/dist/src/index.js';
import type { HostCallHandler } from '../tools/fake-plugin/dist/src/index.js';
import type { ActionPlan, ApprovalBinding, ApprovalCapability } from '../packages/action-plan/dist/src/index.js';
import { bindApproval, issueApproval } from '../packages/action-plan/dist/src/index.js';
import type { StoredPlan } from '../packages/mcp-server/dist/src/contracts.js';
import { nativeRig } from '../apps/sidecar/dist/tests/native-rig.js';
import type { NativeRig, RigOptions } from '../apps/sidecar/dist/tests/native-rig.js';
import { fieldOf, parseJson, recordOf, textOf } from '../apps/sidecar/dist/tests/http-json.js';
import type { JsonObject } from '../apps/sidecar/dist/tests/http-json.js';
import type { ToolCallEnvelope } from '../apps/sidecar/dist/tests/sidecar-fixture.js';
import type { StoredSnapshot } from '../apps/sidecar/dist/src/server-types.js';
import { normalizeProbeSnapshot } from '../apps/sidecar/dist/src/server-normalize.js';
import { COLLECTION_ENTRIES, bindWorld } from './readset-native-host.ts';
import type { HostWorld, Stamp } from './readset-native-host.ts';

const APPLY_ENTRIES = ['aeApplyPlan', 'aeUndoPlan'] as const;

export type Receipt = NonNullable<StoredPlan['receipt']>;

/** The result of an approval: the plan, the tool's answer and the receipt the lane recorded. */
export interface Approval {
  readonly planId: string;
  readonly approved: ToolCallEnvelope;
  readonly receipt: Receipt;
}

/** The stamp the plugin shows now: its epoch, and the revision the simulated project is at. */
export const stampOf = (rig: NativeRig, world: HostWorld): Stamp => ({ epoch: rig.plugin.state.watch.epoch, revision: world.context.app.project.revision });

const idle = (rig: NativeRig): boolean => !rig.sidecar.inFlight && rig.sidecar.agentMailbox.length === 0;

/**
 * Starts the sidecar against a plugin that shows what `world` shows (its project, open composition and selection) and answers its host
 * entries from the world's host library. The pairing read stays: a scoped collection read becomes the current observation beside it.
 */
export async function worldRig(t: Pick<TestContext, 'after'>, world: HostWorld, options: RigOptions = {}): Promise<NativeRig> {
  const project = world.fixture ? { project: world.fixture() } : {};
  const rig = await nativeRig(t, { ...options, plugin: { ...project, ...options.plugin }, noLinkWait: true });
  rig.plugin.state.watch = { ...rig.plugin.state.watch, ...world.watch() };
  bindWorld(rig.plugin, world, [...COLLECTION_ENTRIES, ...APPLY_ENTRIES]);
  await rig.waitFor(() => rig.sidecar.hostLink.status().state === 'online');
  await rig.refresh();
  await rig.waitFor(() => idle(rig));
  return rig;
}

/** The finished bounded demand: one `ae_read_graph_page` call that waits for its page, then the tool's envelope. */
export async function demand(rig: NativeRig, args: JsonObject): Promise<ToolCallEnvelope> {
  const answered = await rig.agent('ae_read_graph_page', { waitSeconds: 10, ...args });
  return answered.body;
}

export async function propose(rig: NativeRig, operations: readonly JsonObject[], summary = 'Plan'): Promise<string> {
  const proposed = await rig.agent('ae_propose_plan', { summary, operations });
  if (typeof fieldOf(proposed.body, 'data.planId') !== 'string') throw new Error(`proposal refused: ${JSON.stringify(proposed.body)}`);
  return textOf(proposed.body, 'data.planId');
}

export const receiptOf = (rig: NativeRig, planId: string): StoredPlan['receipt'] => rig.sidecar.plans.get(planId)?.receipt;

function recordedReceipt(rig: NativeRig, planId: string): Receipt {
  const receipt = receiptOf(rig, planId);
  if (receipt === undefined) throw new Error(`no receipt for ${planId}`);
  return receipt;
}

/** Approves an already proposed plan as an agent and waits until the lane has recorded its receipt. */
export async function approve(rig: NativeRig, planId: string): Promise<Approval> {
  const approved = await rig.agent('ae_approve_plan', { planId, waitSeconds: 10 });
  await rig.waitFor(() => receiptOf(rig, planId) !== undefined, 8000);
  return { planId, approved: approved.body, receipt: recordedReceipt(rig, planId) };
}

/** Proposes `operations` and approves them; `between` runs after the proposal and before the approval (the project moves on meanwhile). */
export async function applyPlan(rig: NativeRig, operations: readonly JsonObject[], between: (planId: string) => void = () => undefined): Promise<Approval> {
  const planId = await propose(rig, operations);
  await between(planId);
  return approve(rig, planId);
}

/** What the sidecar holds as the latest observation, normalised as a plan is authored against it. */
export const latestSnapshot = (rig: NativeRig): ReturnType<typeof normalizeProbeSnapshot> => normalizeProbeSnapshot(latestStored(rig).snapshot);

/** What the sidecar holds as the latest observation, with the provenance it was stored with. */
export function latestStored(rig: NativeRig): StoredSnapshot {
  const latest = rig.sidecar.latest;
  if (latest === undefined) throw new Error('the sidecar holds no observation');
  return latest;
}

/** The raw observation the sidecar holds, as the JSON the plugin sent. */
export function latestRaw(rig: NativeRig): JsonObject {
  return decodeOrThrow(jsonObject, latestStored(rig).snapshot);
}

/** The one-time approval capability issued for `plan` against `snapshot`; the issue must not be refused. */
export function issuedCapability(plan: ActionPlan, snapshot: ReturnType<typeof latestSnapshot>): ApprovalCapability {
  const capability = issueApproval({ plan, snapshot, panelSessionId: 'p' });
  assert.ok(fieldOf(capability, 'token'), JSON.stringify(capability));
  if (!('token' in capability)) throw new Error(JSON.stringify(capability));
  return capability;
}

/** The approval `capability` binds to for `plan` against `snapshot`; the binding must not be refused. */
export function boundApproval(plan: ActionPlan, snapshot: ReturnType<typeof latestSnapshot>, capability: ApprovalCapability): ApprovalBinding {
  const approval = bindApproval(plan, snapshot, capability);
  if ('ok' in approval) throw new Error(JSON.stringify(approval));
  return approval;
}

export function sealedPlan(rig: NativeRig, planId: string): ActionPlan {
  const stored = rig.sidecar.plans.get(planId);
  if (stored === undefined) throw new Error(`no plan ${planId}`);
  return stored.plan;
}

/** The receipt of an apply the host refused before changing anything: rejected, not run, no mutation, with the host's own code. */
export function assertNotApplied(receipt: Receipt, code: string, label = ''): void {
  assert.equal(fieldOf(receipt, 'status'), 'rejected', `${label} ${JSON.stringify(receipt)}`);
  assert.equal(fieldOf(receipt, 'postcondition'), 'not_run', label);
  assert.equal(fieldOf(receipt, 'mayHaveMutated'), false, label);
  assert.equal(fieldOf(receipt, 'mutationState'), 'not-applied', label);
  assert.equal(fieldOf(receipt, 'hostError.code'), code, label);
}

/** The handler the plugin currently answers `entry` with. */
export function hostHandler(rig: NativeRig, entry: HostEntry): HostCallHandler {
  const handler = rig.plugin.hostCalls.get(entry);
  if (handler === undefined) throw new Error(`no handler for ${entry}`);
  return handler;
}

/** Makes the plugin answer `entry` with its own answer's JSON object, the members of `patch` replaced. */
export function patchHostAnswer(rig: NativeRig, entry: HostEntry, patch: JsonObject): void {
  const inner = hostHandler(rig, entry);
  rig.plugin.hostCalls.set(entry, async (args, request, plugin) => {
    const reply = await inner(args, request, plugin);
    if (reply.kind !== 'ok' || typeof reply.result !== 'string') throw new Error(`${entry} gave no JSON text`);
    return ok(JSON.stringify({ ...recordOf(parseJson(reply.result), ''), ...patch }));
  });
}

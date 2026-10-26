/** Tests that the sidecar recovers its plan history on startup. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import type { ActionPlan } from '../packages/action-plan/dist/src/index.js';
import { createPersistentWorkflowStore } from '../packages/workflow/dist/src/persistent-store.js';
import type { PersistentWorkflowStore, WorkflowId } from '../packages/workflow/dist/src/index.js';
import { WorkflowCoordinator } from '../apps/sidecar/dist/src/workflow-coordinator.js';
import type { WorkflowAdmissionAuthority } from '../apps/sidecar/dist/src/workflow-coordinator-types.js';
import { ReadOnlySidecar } from '../apps/sidecar/dist/src/server.js';

const APPROVAL_ID = 'approval-ref:fixture';
const authority: WorkflowAdmissionAuthority = {
  hostProfileId: 'profile-fixture',
  hostBasis: 'fixture',
  hostSupported: true,
  verificationBasis: 'fixture',
  exactVerification: true,
  targetResolved: true,
  policyApprovalId: APPROVAL_ID,
};
let tick = 0;
const now = (): Date => new Date(Date.UTC(2026, 9, 1, 12, 0, tick++));

function buildPlan(): ActionPlan {
  return {
    schemaVersion: '0.2',
    planId: 'plan-fixture',
    snapshotFingerprint: 'snapshot-before',
    selectionFingerprint: 'selection-1',
    freshness: { revision: '1', capturedAt: now().toISOString() },
    summary: 'Synthetic rename',
    requiresApproval: true,
    operations: [{ type: 'set_layer_name', target: { compositionId: 'comp-1', layerId: 'layer-1', snapshotFingerprint: 'snapshot-before', selectionFingerprint: 'selection-1' }, name: 'Synthetic' }],
  };
}

function jobIdOf(coordinator: WorkflowCoordinator, planId: string): WorkflowId {
  const jobId = coordinator.jobIdForPlan(planId);
  if (jobId === null) throw new Error(`no job for plan ${planId}`);
  return jobId;
}

function driveToInterruption(coordinator: WorkflowCoordinator, plan: ActionPlan): void {
  assert.equal(coordinator.admitPlan(plan, { jobId: 'job-fixture', undoGroups: 1, authority }).ok, true);
  coordinator.queue(plan.planId);
  coordinator.bindApproval(plan.planId, APPROVAL_ID, plan.snapshotFingerprint);
  coordinator.claim(plan.planId);
  coordinator.executing(plan.planId);
  coordinator.receipt(plan.planId, {
    receiptId: 'receipt-fixture', planId: plan.planId, status: 'executed', postcondition: 'passed', mayHaveMutated: true, mutationState: 'applied', afterFingerprint: 'snapshot-after',
    verification: { state: 'exact', steps: [{ operation: 'set_layer_name', verificationState: 'exact', observed: true, basis: 'layer-name-read-back' }] },
  });
  coordinator.blockJob(jobIdOf(coordinator, plan.planId), 'workflow:interrupted-before-completion');
}

function assertSidecarPreservesHistory(dir: string, filePath: string): void {
  const before = fs.readFileSync(filePath, 'utf8');
  const sidecar = new ReadOnlySidecar({ stateDirectory: dir, token: 'fixture-sidecar-token-123456789', port: 0, now });
  assert.equal(fs.readFileSync(filePath, 'utf8'), before, 'constructor must preserve persisted history');
  sidecar.resumeRecoverableWorkflowJobs();
  sidecar.wakeDeferredWorkflowContinuations();
  assert.equal(fs.readFileSync(filePath, 'utf8'), before, 'wake without fresh snapshot must preserve history');
  sidecar.workflowCoordinator.close();
}

function failingOnceStore(store: PersistentWorkflowStore, armed: { failOnce: boolean }): PersistentWorkflowStore {
  return {
    ...store,
    append: event => {
      if (armed.failOnce) {
        armed.failOnce = false;
        throw Error('synthetic persistence failure');
      }
      return store.append(event);
    },
  };
}

function assertRepeatedControlsStayUnique(filePath: string, id: WorkflowId): PersistentWorkflowStore {
  const reopened = createPersistentWorkflowStore({ filePath });
  const armed = { failOnce: false };
  const resumed = new WorkflowCoordinator({ store: failingOnceStore(reopened, armed), now: () => new Date('2026-10-01T12:00:00.000Z') });
  for (let i = 0; i < 3; i++) {
    resumed.reopenForContinuation(id);
    resumed.reopenForContinuation(id);
    resumed.blockJob(id, 'workflow:snapshot-unavailable');
  }
  const events = reopened.listEvents(id);
  assert.equal(new Set(events.map(event => event.eventId)).size, events.length);
  armed.failOnce = true;
  assert.throws(() => resumed.reopenForContinuation(id), /synthetic persistence failure/);
  resumed.reopenForContinuation(id);
  resumed.blockJob(id, 'workflow:retry-after-persistence-failure');
  return reopened;
}

function run(dir: string): void {
  const filePath = path.join(dir, 'workflow-store.json');
  const store = createPersistentWorkflowStore({ filePath });
  const coordinator = new WorkflowCoordinator({ store, now });
  const plan = buildPlan();
  driveToInterruption(coordinator, plan);
  const id = jobIdOf(coordinator, plan.planId);
  store.close();
  assertSidecarPreservesHistory(dir, filePath);
  assertRepeatedControlsStayUnique(filePath, id).close();
  const finalStore = createPersistentWorkflowStore({ filePath });
  assert.equal(finalStore.getState().jobs[id]?.status, 'blocked');
  finalStore.close();
  console.log('startup history preserved; repeated controls use unique durable IDs');
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'extynt-startup-transition-'));
try {
  run(directory);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

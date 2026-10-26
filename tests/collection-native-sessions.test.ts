// What the sidecar does when the project moves under a collection job: the host script refuses to continue its session and the
// sidecar fails the demand with the host's code, drops what the job retained, and starts the next job fresh. Same-count edits
// that leave the revision alone are observed but never claimed to be an atomic snapshot.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { HostRig } from '../apps/sidecar/dist/tests/host-rig.js';
import type { JsonObject } from '../apps/sidecar/dist/tests/http-json.js';
import { fieldOf, textOf } from '../apps/sidecar/dist/tests/http-json.js';
import { codeOf, collectionRig, demandPage, rowKey, simulatedHost } from './collection-native-support.ts';
import type { SimulatedHost } from './collection-native-support.ts';

const INDEX = { kind: 'index' };
const begin = { schemaVersion: '0.1', requestId: 'elsewhere', begin: true };

type RigBody = (rig: HostRig, host: SimulatedHost) => Promise<void>;

interface Continuation {
  readonly first: JsonObject;
  readonly next: JsonObject;
}

async function withRig(size: number, body: RigBody): Promise<void> {
  const host = simulatedHost(size), rig = await collectionRig(host);
  try { await body(rig, host); } finally { await rig.close(); }
}

const retained = (rig: HostRig, id: string): string => textOf(rig.sidecar.collection.lookup(rowKey('index', id)), 'state');

async function continueAfter(rig: HostRig, moved: (first: JsonObject) => void): Promise<Continuation> {
  const first = await demandPage(rig, { target: INDEX, limit: 25 });
  assert.equal(fieldOf(first, 'data.state'), 'observed');
  moved(first);
  const next = await demandPage(rig, { jobId: textOf(first, 'data.continuation.jobId'), limit: 25 });
  return { first, next };
}

test('a project restructured between pages fails the continuation, drops the stale prefix, and the next job sees the new project', async () => {
  await withRig(300, async (rig, host) => {
    const { next } = await continueAfter(rig, () => {
      assert.equal(retained(rig, '1'), 'observed', 'the first page is retained');
      host.items.push(host.newItem(301));
      host.project.numItems += 1;
    });
    assert.equal(codeOf(next), 'PROJECT_CHANGED');
    assert.equal(retained(rig, '1'), 'unknown', 'what the job had retained is cleared');
    assert.equal(rig.sidecar.collection.hasUnsettled(textOf(next, 'data.demandId')), false);
    const fresh = await demandPage(rig, { target: INDEX, limit: 25 });
    assert.equal(fieldOf(fresh, 'data.page.totalItems'), 301);
  });
});

test('another host session replaces the job\'s: the old one is refused as STALE_COLLECTION, and the page never claims atomic consistency', async () => {
  await withRig(100, async (rig, host) => {
    const { first, next } = await continueAfter(rig, started => {
      const other = host.call('aeCollectIndexPage', begin);
      assert.notEqual(textOf(other, 'sessionId'), textOf(started, 'data.page.sessionId'));
    });
    assert.equal(fieldOf(first, 'data.page.consistency'), 'observational');
    assert.equal(fieldOf(first, 'data.page.deepComplete'), false);
    assert.equal(fieldOf(first, 'data.coverage.absentOutsidePage'), 'unknown');
    assert.equal(codeOf(next), 'STALE_COLLECTION');
    assert.equal(fieldOf(next, 'data.recovery.action'), 'demand-fresh-evidence');
    assert.equal(retained(rig, '1'), 'unknown');
    const fresh = await demandPage(rig, { target: INDEX, limit: 25 });
    assert.notEqual(textOf(fresh, 'data.page.sessionId'), textOf(first, 'data.page.sessionId'), 'a new job is a new host session');
  });
});

test('a project switched for another of the same size, or an item deleted, between pages refuses the continuation', async () => {
  await withRig(100, async (rig, host) => {
    const { next: switched } = await continueAfter(rig, () => { host.app.project = { ...host.project }; });
    assert.equal(codeOf(switched), 'PROJECT_CHANGED');
    host.app.project = host.project;
    const { next: deleted } = await continueAfter(rig, () => { host.project.numItems -= 1; host.items.shift(); });
    assert.equal(codeOf(deleted), 'PROJECT_CHANGED');
    assert.equal(retained(rig, '1'), 'unknown');
  });
});

test('a same-count external replacement is observed as it is, with no claim of an atomic snapshot', async () => {
  await withRig(100, async (rig, host) => {
    const { first, next } = await continueAfter(rig, () => { host.itemAt(30).id = 9999; host.itemAt(30).name = 'replacement'; });
    assert.equal(fieldOf(next, 'data.state'), 'observed');
    assert.equal(fieldOf(next, 'data.page.rows.5.id'), '9999');
    assert.equal(fieldOf(next, 'data.page.consistency'), 'observational');
    assert.equal(fieldOf(next, 'data.page.deepComplete'), false);
    assert.equal(fieldOf(next, 'data.coverage.absentOutsidePage'), 'unknown');
    assert.equal(fieldOf(first, 'data.coverage.dependencyClosure'), 'unknown');
  });
});

test('a same-count external edit and an undo both move the revision, and each refuses the continuation', async () => {
  await withRig(100, async (rig, host) => {
    const { next: edited } = await continueAfter(rig, () => { host.itemAt(30).name = 'external edit'; host.project.revision += 1; });
    assert.equal(codeOf(edited), 'PROJECT_CHANGED');
    const { next: undone } = await continueAfter(rig, () => { host.project.revision += 1; });
    assert.equal(codeOf(undone), 'PROJECT_CHANGED', 'identical counts are not enough');
    const fresh = await demandPage(rig, { target: INDEX, limit: 25 });
    assert.equal(fieldOf(fresh, 'data.state'), 'observed');
    assert.equal(fieldOf(fresh, 'data.page.stamp.revision'), 6);
  });
});

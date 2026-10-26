/** Tests the native bridge lease: reservations survive restart and read leases never block. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, readFileSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { NativeBridgeLease } from '../apps/sidecar/dist/src/native-bridge-lease.js';
import { acceptNativeBridge } from '../apps/sidecar/dist/src/server-native-bridge-route.js';
import type { LogFields } from '../apps/sidecar/dist/src/server-plan-log.js';
import { ReadOnlySidecar } from '../apps/sidecar/dist/src/server.js';
import { decodeOrThrow, jsonObject } from '../packages/decode/dist/src/index.js';
import type { JsonObject } from '../packages/decode/dist/src/index.js';
import type { ReceiverOutcome } from '../apps/sidecar/dist/src/receiver-types.js';
import { fieldOf, parseJson, textOf } from '../apps/sidecar/dist/tests/http-json.js';

function fixture(fn: (d: string) => void): void { const d=mkdtempSync(join(tmpdir(),'extynt-bridge-')); try {fn(d);} finally {rmSync(d,{recursive:true,force:true});} }
test('mutation reservation survives restart; exact old owner settles and stale replay cannot clear successor',()=>fixture((d: string)=>{
 const a=new NativeBridgeLease(d), first=a.reserve('old',{requestId:'one',kind:'mutation'}).lease;
 const b=new NativeBridgeLease(d); assert.ok(b.accessQuarantine()); assert.throws(()=>b.reserve('new',{requestId:'two',kind:'mutation'}),/BUSY/);
 assert.throws(()=>b.settle('new',{lease:first,outcome:'callback-received'}),/INVALID/);
 assert.equal(b.settle('old',{lease:first,outcome:'callback-received'}).settled,true);
 const second=b.reserve('new',{requestId:'two',kind:'mutation'}).lease;
 assert.equal(b.settle('old',{lease:first,outcome:'callback-received'}).idempotent,true); assert.ok(b.accessQuarantine());
 assert.throws(()=>b.settle('new',{lease:{...second,settlementToken:'wrong'},outcome:'callback-received'}),/MISMATCH/);
 b.settle('new',{lease:second,outcome:'native-not-started'}); assert.equal(b.accessQuarantine(),null);
}));
test('a read lease never blocks: access stays open and any owner replaces it; a mutation lease is never overtaken',()=>fixture((d: string)=>{
 const a=new NativeBridgeLease(d), read=a.reserve('old',{requestId:'read',kind:'read'}).lease;
 assert.equal(a.accessQuarantine(),null); assert.equal(new NativeBridgeLease(d).accessQuarantine(),null,'also after a restart');
 const b=new NativeBridgeLease(d), second=b.reserve('new',{requestId:'read-2',kind:'read'}).lease;
 assert.notEqual(second.leaseId,read.leaseId); assert.equal(b.activeRequestMatches('read'),false); assert.equal(b.activeRequestMatches('read-2'),true);
 assert.throws(()=>b.settle('old',{lease:read,outcome:'callback-received'}),/MISMATCH/,'the replaced read can no longer settle');
 const mutation=b.reserve('newer',{requestId:'mutation',kind:'mutation'}).lease; assert.equal(textOf(b.accessQuarantine(),'accessKind'),'mutation');
 for(const kind of ['read','mutation']) assert.throws(()=>b.reserve('other',{requestId:'after-'+kind,kind}),/BUSY/);
 assert.equal(textOf(b.accessQuarantine(),'requestId'),'mutation');
 b.settle('newer',{lease:mutation,outcome:'callback-received'}); assert.equal(b.accessQuarantine(),null);
}));
test('releaseForNewOwner retires another owner\'s lease as owner-replaced; its late settle is a mismatch; the same owner and an empty journal change nothing',()=>fixture((d: string)=>{
 const a=new NativeBridgeLease(d); assert.deepEqual(a.releaseForNewOwner('new'),{released:false});
 for(const kind of ['read','mutation']){
  const lease=a.reserve('old',{requestId:'req-'+kind,kind},{kind:'apply_plan',id:'plan-'+kind}).lease;
  assert.deepEqual(a.releaseForNewOwner('old'),{released:false},'the same panel instance re-pairing keeps its lease'); assert.equal(a.activeRequestMatches('req-'+kind),true);
  assert.deepEqual(a.releaseForNewOwner('new'),{released:true,kind,logicalOwner:{kind:'apply_plan',id:'plan-'+kind}});
  assert.equal(a.accessQuarantine(),null); assert.equal(a.activeRequestMatches('req-'+kind),false);
  assert.equal(fieldOf(parseJson(readFileSync(join(d,'native-bridge-lease.json'),'utf8')),'settled.outcome'),'owner-replaced');
  assert.throws(()=>a.settle('old',{lease,outcome:'callback-received'}),/MISMATCH/);
  assert.throws(()=>a.settle('old',{lease,outcome:'native-not-started'}),/MISMATCH/);
 }
}));
test('two managers serialize reserve and never overwrite active intent',()=>fixture((d: string)=>{
 const a=new NativeBridgeLease(d), b=new NativeBridgeLease(d); const lease=a.reserve('panel',{requestId:'a',kind:'mutation'},{kind:'apply_plan',id:'plan'}).lease;
 assert.throws(()=>b.reserve('panel',{requestId:'b',kind:'read'}),/BUSY/);
 const result=b.settle('panel',{lease,outcome:'callback-received'}); assert.deepEqual(result.logicalOwner,{kind:'apply_plan',id:'plan'});
}));
test('malformed journal and dangling symlink fail closed; a held lock is BUSY, never a sticky storage error, and a lock older than 10 s is cleared',()=>fixture((d: string)=>{
 const f=join(d,'native-bridge-lease.json'); writeFileSync(f,'{}',{mode:0o600}); assert.ok(new NativeBridgeLease(d).accessQuarantine());
 assert.throws(()=>new NativeBridgeLease(d).reserve('p',{requestId:'a',kind:'read'}),/STORAGE/); rmSync(f);
 symlinkSync(join(d,'missing'),f); assert.ok(new NativeBridgeLease(d).accessQuarantine()); rmSync(f);
 const lock=f+'.lock'; writeFileSync(lock,'',{mode:0o600});
 const held=new NativeBridgeLease(d); assert.equal(held.accessQuarantine(),null,'a lock held by another update is not a storage error');
 assert.throws(()=>held.reserve('p',{requestId:'a',kind:'read'}),/BUSY/); assert.ok(existsSync(lock),'a fresh lock is never stolen');
 const old=new Date(Date.now()-20000); utimesSync(lock,old,old);
 const lease=held.reserve('p',{requestId:'a',kind:'read'}).lease; assert.ok(lease.leaseId); assert.equal(existsSync(lock),false,'the crash-left lock aged out and was cleared');
 assert.equal(held.accessQuarantine(),null);
 writeFileSync(lock,'',{mode:0o600}); utimesSync(lock,old,old); assert.equal(new NativeBridgeLease(d).accessQuarantine(),null); assert.equal(existsSync(lock),false);
}));
test('reserve records bounded secret journal before returning ACK',()=>fixture((d: string)=>{
 const a=new NativeBridgeLease(d); const result=a.reserve('p',{requestId:'request',kind:'read'});
 const journal=parseJson(readFileSync(join(d,'native-bridge-lease.json'),'utf8')); assert.deepEqual(fieldOf(journal,'active.identity'),result.lease);
 assert.equal(JSON.stringify(a.accessQuarantine()).includes(result.lease.settlementToken),false);
}));
test('actual process death before ACK: only a persisted mutation lease blocks; a crash lock blocks reservations until it is 10 s old',()=>{
 for(const stage of ['lock','fsync','rename']) fixture((d: string)=>{
  const moduleUrl=new URL('../apps/sidecar/dist/src/native-bridge-lease.js',import.meta.url).href;
  const code=`import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
const stage=${JSON.stringify(stage)}; const kill=()=>process.kill(process.pid,'SIGKILL');
const open=fs.openSync; fs.openSync=function(...a){const v=open(...a);if(stage==='lock'&&String(a[0]).endsWith('.lock'))kill();return v;};
const sync=fs.fsyncSync; fs.fsyncSync=function(...a){sync(...a);if(stage==='fsync')kill();};
const rename=fs.renameSync; fs.renameSync=function(...a){rename(...a);if(stage==='rename')kill();};
syncBuiltinESMExports(); const {NativeBridgeLease}=await import(${JSON.stringify(moduleUrl)}); new NativeBridgeLease(${JSON.stringify(d)}).reserve('p',{requestId:'crash',kind:'mutation'});`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',code]); assert.equal(child.signal,'SIGKILL');
  const restarted=new NativeBridgeLease(d);
  if(stage==='rename'){assert.equal(textOf(restarted.accessQuarantine(),'accessKind'),'mutation');assert.throws(()=>restarted.reserve('new',{requestId:'new',kind:'read'}),/BUSY/);}
  else assert.equal(restarted.accessQuarantine(),null);
  const lock=join(d,'native-bridge-lease.json.lock'); assert.ok(existsSync(lock));
  assert.throws(()=>restarted.reserve('new',{requestId:'new',kind:'read'}),/BUSY/,'a fresh crash lock is respected');
  const old=new Date(Date.now()-20000); utimesSync(lock,old,old);
  if(stage==='rename') assert.throws(()=>restarted.reserve('new',{requestId:'new',kind:'read'}),/BUSY/,'the cleared lock leaves the durable mutation lease in force');
  else assert.ok(restarted.reserve('new',{requestId:'new',kind:'read'}).lease);
 });
});
test('active request matching excludes settled and superseded generic event identities',()=>fixture((d: string)=>{
 const bridge=new NativeBridgeLease(d);const lease=bridge.reserve('p',{requestId:'late',kind:'read'}).lease;bridge.settle('p',{lease,outcome:'callback-received'});
 assert.equal(bridge.activeRequestMatches('late'),false);
 const next=bridge.reserve('p',{requestId:'next',kind:'read'}).lease;assert.equal(bridge.activeRequestMatches('late'),false);assert.equal(bridge.activeRequestMatches('next'),true);
 bridge.settle('p',{lease:next,outcome:'callback-received'});
}));
type Bridge = 'reserve' | 'settle';
interface RouteWorld { readonly sidecar: ReadOnlySidecar; readonly wakes: () => number; readonly logs: ReadonlyArray<readonly [string, LogFields]> }

function routeWorld(directory: string): RouteWorld {
  const logs: Array<readonly [string, LogFields]> = [];
  let wakes = 0, nativeReleased = false, collectionReleased = false;
  const sidecar = new ReadOnlySidecar({ port: 0, token: 'synthetic-token', stateDirectory: directory });
  sidecar.activePanelInstanceId = 'old';
  sidecar.collection.nativeAccessQuarantine = () => null;
  sidecar.collection.admittedNativeTicket = () => 'ticket';
  sidecar.collection.settleNativeAfterBridge = (id) => { assert.equal(id, 'ticket'); collectionReleased = true; };
  sidecar.releaseNativeFlight = (id) => { assert.equal(id, 'ticket'); nativeReleased = true; };
  sidecar.notifyChange = () => {};
  sidecar.logPlanEvent = (type, data) => { logs.push([type, data]); };
  sidecar.wakeDeferredWorkflowContinuations = () => {
    assert.equal(nativeReleased, true); assert.equal(collectionReleased, true); assert.equal(sidecar.nativeBridge.accessQuarantine(), null); wakes++;
  };
  return { sidecar, wakes: () => wakes, logs };
}

function bridgeCall(world: RouteWorld, owner: string, action: Bridge, body: JsonObject): ReceiverOutcome {
  return acceptNativeBridge({ state: world.sidecar, dispatch: world.sidecar }, { action, body, owner });
}

function leaseOf(outcome: ReceiverOutcome): JsonObject {
  return decodeOrThrow(jsonObject, fieldOf(outcome.body, 'lease'));
}

test('actual route binds an admitted collection read and permits its exact old owner settlement without ever blocking access', () => {
  const d = mkdtempSync(join(tmpdir(), 'extynt-route-'));
  try {
    const world = routeWorld(d), { sidecar } = world;
    const denied = bridgeCall(world, 'old', 'reserve', { requestId: 'one', kind: 'read' });
    assert.equal(denied.status, 409); assert.equal(fieldOf(denied.body, 'nativeAdmission'), 'refused'); assert.equal(sidecar.nativeBridge.accessQuarantine(), null);
    assert.equal(world.wakes(), 0);
    const accepted = bridgeCall(world, 'old', 'reserve', { requestId: 'one', kind: 'read', collectionTicket: 'ticket' });
    assert.equal(accepted.status, 200); sidecar.activePanelInstanceId = 'new';
    assert.equal(world.wakes(), 0); assert.equal(sidecar.nativeBridge.accessQuarantine(), null, 'an admitted read never blocks native access');
    const stale = bridgeCall(world, 'new', 'settle', { lease: leaseOf(accepted), outcome: 'callback-received' });
    assert.equal(stale.status, 409); assert.equal(world.wakes(), 0);
    const wrong = bridgeCall(world, 'old', 'settle', { lease: { ...leaseOf(accepted), settlementToken: 'wrong' }, outcome: 'callback-received' });
    assert.equal(wrong.status, 409); assert.equal(world.wakes(), 0); assert.equal(sidecar.nativeBridge.activeRequestMatches('one'), true, 'wrong proof leaves the lease in place');
    const settled = bridgeCall(world, 'old', 'settle', { lease: leaseOf(accepted), outcome: 'callback-received' });
    assert.equal(settled.status, 200); assert.equal(sidecar.nativeBridge.accessQuarantine(), null);
    assert.equal(world.wakes(), 1); assert.deepEqual(world.logs, []);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

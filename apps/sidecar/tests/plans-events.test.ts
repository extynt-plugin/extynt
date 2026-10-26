/** The `plans` event: one per change to the plan list, whoever made it, and one when an approval window runs out. */
import assert from "node:assert/strict";
import test from "node:test";
import { decode, object, string } from "@extynt/decode";
import { earliestExpiry, setPlanExpiryTimers, type ExpiryTimers } from "../src/plans-events.js";
import { uiEventsFor } from "../src/ui-events.js";
import type { UiEvent } from "../src/ui-contract.js";
import { COMP, LAYER, nativeRig, until, type NativeRig } from "./native-rig.js";
import { openSse } from "./ui-fixture.js";

function plansSeen(rig: NativeRig): UiEvent[] {
  const seen: UiEvent[] = [];
  uiEventsFor(rig.sidecar).subscribe((event) => { if (event.type === "plans") seen.push(event); });
  return seen;
}

const proposedPlan = object({ planId: string() });

interface PendingTimer {
  readonly run: () => void;
  readonly delayMs: number;
}

interface ManualTimers extends ExpiryTimers {
  readonly pending: PendingTimer[];
}

function manual(): ManualTimers {
  const pending: PendingTimer[] = [];
  return {
    pending,
    start: (run, delayMs) => {
      const entry: PendingTimer = { run: () => { drop(entry); run(); }, delayMs };
      pending.push(entry);
      return { cancel: () => drop(entry) };
    },
  };
  function drop(entry: PendingTimer): void {
    const at = pending.indexOf(entry);
    if (at >= 0) pending.splice(at, 1);
  }
}

function pendingOf(timers: ManualTimers): PendingTimer {
  const [first] = timers.pending;
  if (!first) throw new Error("no timer is waiting");
  return first;
}

function expiryOf(rig: NativeRig, planId: string): number {
  const text = rig.sidecar.plans.get(planId)?.approvalCapability?.expiresAt;
  if (!text) throw new Error(`plan ${planId} has no approval window`);
  return Date.parse(text);
}

test("a proposal from an external agent sends one plans event, and the panel stream carries it", async (t) => {
  const rig = await nativeRig(t);
  const client = await openSse(Number(new URL(rig.base).port));
  t.after(() => client.close());
  await client.waitFor((frame) => frame.event === "change");
  const seen = plansSeen(rig);
  const planId = await rig.proposeRename();
  assert.deepEqual(seen, [{ type: "plans", reason: "proposed", planId }]);
  const frame = await client.waitFor((entry) => entry.event === "plans");
  assert.deepEqual(frame.data, { reason: "proposed", planId });
  assert.equal(rig.sidecar.hostFacts.planSources.get(planId), "agent", "the proposer is known before any approval");
});

test("amend, approve and discard each send a plans event", async (t) => {
  const rig = await nativeRig(t);
  const first = await rig.proposeRename("One"), second = await rig.proposeRename("Two");
  const seen = plansSeen(rig);
  const amended = await rig.agent("ae_amend_plan", { planId: first, edits: [{ op: "replace", index: 0, operation: { type: "set_layer_name", target: { compositionId: COMP, layerId: LAYER }, name: "Amended" } }] });
  assert.equal(amended.body.ok, true, JSON.stringify(amended.body));
  assert.equal((await rig.agent("ae_cancel_plan", { planId: second })).body.ok, true);
  const approved = await rig.agent("ae_approve_plan", { planId: first });
  assert.equal(approved.body.ok, true, JSON.stringify(approved.body));
  assert.deepEqual(seen.map((event) => (event.type === "plans" ? event.reason : "")), ["amended", "discarded", "approved"]);
});

test("a refused call sends nothing", async (t) => {
  const rig = await nativeRig(t);
  const seen = plansSeen(rig);
  const refused = await rig.agent("ae_cancel_plan", { planId: "no-such-plan" });
  assert.equal(refused.body.ok, false);
  assert.deepEqual(seen, []);
});

test("the panel's own auto-approval sends a plans event", async (t) => {
  const rig = await nativeRig(t);
  const planId = await rig.proposeRename();
  const seen = plansSeen(rig);
  rig.sidecar.queueReadyPlan({ planId, operationCount: 1 }, { requestId: "turn-1", autoApply: true });
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
  assert.ok(seen.some((event) => event.type === "plans" && event.reason === "approved" && event.planId === planId));
});

test("a plan the in-panel agent proposes sends a plans event and is the panel's own before anyone approves it", async (t) => {
  const rig = await nativeRig(t);
  const seen = plansSeen(rig);
  const turn = { requestId: "panel-turn", message: "rename it", history: [], autoApply: false };
  const proposed = await rig.sidecar.runAgentTool("ae_propose_plan", { summary: "Rename", operations: [{ type: "set_layer_name", target: { compositionId: COMP, layerId: LAYER }, name: "Panel" }] }, turn, {});
  assert.equal(proposed.ok, true, JSON.stringify(proposed));
  const named = proposed.ok ? decode(proposedPlan, proposed.data) : undefined;
  const planId = named?.ok ? named.value.planId : "";
  assert.deepEqual(seen, [{ type: "plans", reason: "proposed", planId }]);
  assert.equal(rig.sidecar.hostFacts.planSources.get(planId), "panel");
});

test("the earliest expiry is the soonest one still ahead, among plans that can still be applied", async (t) => {
  const rig = await nativeRig(t);
  const planId = await rig.proposeRename();
  const record = rig.sidecar.plans.get(planId);
  if (!record) throw new Error("the proposed plan is missing");
  const at = expiryOf(rig, planId);
  assert.equal(earliestExpiry(rig.sidecar.plans.values(), 0), at);
  assert.equal(earliestExpiry(rig.sidecar.plans.values(), at), null, "an expiry already reached is not ahead");
  record.status = "verified";
  assert.equal(earliestExpiry(rig.sidecar.plans.values(), 0), null, "an applied plan has no window left to watch");
});

test("a timer waits for the earliest expiry, announces it once, and moves to the next", async (t) => {
  let now = Date.UTC(2026, 9, 5, 12, 0, 0);
  const rig = await nativeRig(t, { sidecar: { now: () => new Date(now) } });
  const timers = manual();
  setPlanExpiryTimers(rig.sidecar, timers);
  const first = await rig.proposeRename("One");
  assert.equal(timers.pending.length, 1);
  const firstAt = expiryOf(rig, first);
  assert.equal(pendingOf(timers).delayMs, firstAt - now + 1);
  now += 60_000;
  const second = await rig.proposeRename("Two");
  assert.equal(timers.pending.length, 1, "one timer, re-aimed, not one per plan");
  assert.equal(pendingOf(timers).delayMs, firstAt - now + 1, "it still waits for the earlier one");
  const seen = plansSeen(rig);
  now = firstAt + 1;
  pendingOf(timers).run();
  assert.deepEqual(seen, [{ type: "plans", reason: "expired" }]);
  const secondAt = expiryOf(rig, second);
  assert.equal(timers.pending.length, 1);
  assert.equal(pendingOf(timers).delayMs, secondAt - now + 1, "and then for the next");
  now = secondAt + 1;
  pendingOf(timers).run();
  assert.equal(seen.length, 2);
  assert.equal(timers.pending.length, 0, "nothing left to wait for");
});

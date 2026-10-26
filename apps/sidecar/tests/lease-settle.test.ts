/** Settling a mutation lease: a settle that finds the journal lock busy is retried, a refusal that is not busy is not. */
import assert from "node:assert/strict";
import test from "node:test";
import { settleNativeLease } from "../src/host/lease.js";
import type { BridgeLane, NativeLease } from "../src/host/lease.js";
import type { ReceiverOutcome } from "../src/receiver-types.js";

const BUSY: ReceiverOutcome = { status: 409, outcome: "rejected", body: { ok: false, error: { code: "NATIVE_BRIDGE_BUSY", message: "busy" } } };
const LEASE: NativeLease = { leaseId: "lease", settlementToken: "token", epoch: "epoch", owner: "owner", requestId: "request", kind: "mutation" };
const SETTLED: ReceiverOutcome = { status: 200, outcome: "succeeded", body: { ok: true, settled: true } };

function bridgeAnswering(answers: ReceiverOutcome[]): { ctx: BridgeLane; calls: () => number } {
  let calls = 0;
  const nativeBridge = async (): Promise<ReceiverOutcome> => answers[Math.min(calls++, answers.length - 1)] ?? BUSY;
  return { ctx: { receivers: { nativeBridge } }, calls: () => calls };
}

test("a settle that finds the journal lock busy once is retried, and the lease settles", async () => {
  const { ctx, calls } = bridgeAnswering([BUSY, SETTLED]);
  assert.equal(await settleNativeLease(ctx, LEASE, "callback-received"), true);
  assert.equal(calls(), 2);
});

test("a settle that stays busy gives up after a bounded number of tries and reports it unsettled", async () => {
  const { ctx, calls } = bridgeAnswering([BUSY]);
  assert.equal(await settleNativeLease(ctx, LEASE, "callback-received"), false);
  assert.equal(calls(), 4, "one try and three retries");
});

test("a settle refused for any other reason is not retried", async () => {
  const mismatch: ReceiverOutcome = { status: 409, outcome: "rejected", body: { ok: false, error: { code: "NATIVE_BRIDGE_IDENTITY_MISMATCH", message: "no" } } };
  const { ctx, calls } = bridgeAnswering([mismatch, SETTLED]);
  assert.equal(await settleNativeLease(ctx, LEASE, "native-not-started"), false);
  assert.equal(calls(), 1);
});

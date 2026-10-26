/** The bare outcome an apply receipt is posted as again when the sidecar refuses its evidence keeps the reason the plan failed. */
import assert from "node:assert/strict";
import test from "node:test";
import { postApplyReceipt } from "../src/host/apply-support.js";
import type { PostedReceipt } from "../src/host/apply-support.js";
import type { InProcessReceivers, ReceiverOutcome } from "../src/receiver-types.js";
import { startHostRig } from "./host-rig.js";

const REFUSED: ReceiverOutcome = { status: 409, body: { error: { code: "CONTRADICTORY_RECEIPT" } }, outcome: "rejected", errorCode: "CONTRADICTORY_RECEIPT" };
const ACCEPTED: ReceiverOutcome = { status: 200, body: {}, outcome: "succeeded" };

test("a receipt refused on its evidence is posted again with its error, host error and executed status kept", async (t) => {
  const rig = await startHostRig();
  t.after(() => rig.close());
  const posted: Array<Parameters<InProcessReceivers["acceptReceipt"]>[0]> = [];
  const receipt: PostedReceipt = {
    planId: "plan-1", status: "executed", error: { code: "E_REASON", message: "the reason" }, hostError: { code: "E_HOST", message: "the host said" },
    verificationTrimmed: true, afterFingerprint: "after",
  };
  const receivers = { ...rig.receivers, acceptReceipt: async (body: Parameters<InProcessReceivers["acceptReceipt"]>[0]) => { posted.push(body); return posted.length === 1 ? REFUSED : ACCEPTED; } };
  await postApplyReceipt({ ...rig.context, receivers }, receipt);
  assert.equal(posted.length, 2);
  assert.deepEqual(posted[1], {
    planId: "plan-1", status: "executed", error: { code: "E_REASON", message: "the reason" }, hostError: { code: "E_HOST", message: "the host said" },
    postcondition: "verification_unavailable",
  });
});

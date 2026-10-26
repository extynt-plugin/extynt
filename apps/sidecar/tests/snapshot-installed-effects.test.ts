/** A snapshot with one malformed installed-effect row is still accepted (201): the bad row is dropped and the good one is kept. */
import assert from "node:assert/strict";
import test from "node:test";
import { mutableSnapshot, queueHarness } from "./sidecar-fixture.js";

test("one bad installedEffects row does not reject the snapshot; the good row becomes the inventory", async (t) => {
  const harness = await queueHarness(t);
  const base = mutableSnapshot("probe-effects");
  const body = { ...base, result: { ...base.result, installedEffects: [{ matchName: 5 }, "junk", { matchName: "ADBE Gaussian Blur 2", displayName: "Gaussian Blur", available: true }] } };
  const posted = await harness.post("/v1/snapshots", body);
  assert.equal(posted.status, 201);
  assert.deepEqual(harness.sidecar.inventory?.items.map((item) => item.matchName), ["ADBE Gaussian Blur 2"]);
});

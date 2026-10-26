/** A census refused because After Effects has a dialog open is asked again every few seconds until the dialog is closed, without using up the one SCRIPT_FAILED retry. */
import assert from "node:assert/strict";
import test from "node:test";
import { ok, refuse, toWire } from "@extynt/fake-plugin";
import { startHostRig } from "./host-rig.js";
import { censusAnswer } from "./sidecar-fixture.js";

const DIALOG = "aeHostCensus was not run: After Effects has a dialog open";

test("a census refused while a dialog is open is asked again until it is closed, then succeeds", async () => {
  let calls = 0;
  const rig = await startHostRig({ plugin: { hostCalls: { aeHostCensus: (args) => (++calls <= 3 ? refuse("HOST_MODAL_DIALOG", DIALOG) : ok(toWire(censusAnswer(args, 2)))) } } });
  try {
    rig.readers.queueCensus();
    for (let round = 0; round < 3; round += 1) {
      await rig.drain();
      const check = rig.sidecar.hostFacts.checks.census;
      assert.deepEqual([check?.ok, check?.ok === false && check.code], [false, "HOST_MODAL_DIALOG"]);
      assert.equal(rig.sidecar.panel.lastError, null, "waiting for a dialog is not a failure");
      assert.ok(rig.timers.waiting() >= 1, "the next ask is waiting on its timer");
      rig.timers.fire();
    }
    await rig.drain();
    assert.equal(calls, 5, "three refusals, the effects census, then the fonts");
    assert.equal(rig.sidecar.hostFacts.checks.census?.ok, true);
    assert.equal(rig.sidecar.hostFacts.checks.library?.ok, true);
    assert.equal(rig.sidecar.inventory?.items.length, 2);
  } finally { await rig.close(); }
});

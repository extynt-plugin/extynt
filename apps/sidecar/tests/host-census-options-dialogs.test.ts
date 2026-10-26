/** The plugin's PiPL scan marks the effects that declare an options dialog on the inventory; a census that arrives before the scan finished is asked once more. */
import assert from "node:assert/strict";
import test from "node:test";
import { array, decode, object, string } from "@extynt/decode";
import { ok, toWire } from "@extynt/fake-plugin";
import type { HostCallHandler } from "@extynt/fake-plugin";
import { startHostRig } from "./host-rig.js";
import { present } from "./present.js";
import { censusAnswer } from "./sidecar-fixture.js";

const censusEffects = object({ result: object({ installedEffects: array(object({ matchName: string() })) }) });

function effectNames(args: Parameters<HostCallHandler>[0]): string[] {
  const decoded = decode(censusEffects, censusAnswer(args, 2));
  return decoded.ok ? decoded.value.result.installedEffects.map((item) => item.matchName) : [];
}

test("an effect the scan says has an options dialog is marked on the inventory, the rest stay unknown", async () => {
  let scanned = false;
  const rig = await startHostRig({ plugin: { hostCalls: { aeHostCensus: (args) => {
    const names = effectNames(args);
    return scanned ? ok(toWire(censusAnswer(args, 2)), { hostMeta: { optionsDialogScan: [{ matchName: present(names[0]), hasOptionsDialog: true }] } }) : ok(toWire(censusAnswer(args, 2)), { hostMeta: { optionsDialogScanPending: true } });
  } } } });
  try {
    rig.readers.queueCensus();
    await rig.drain();
    assert.equal(rig.sidecar.inventory?.items.some((item) => item.hasOptionsDialog !== undefined), false, "no scan yet: nothing is claimed");
    assert.ok(rig.timers.waiting() >= 1, "the plugin said the scan is running, so the census is asked again");
    scanned = true;
    rig.timers.fire();
    await rig.drain();
    const items = rig.sidecar.inventory?.items ?? [];
    assert.equal(items.filter((item) => item.hasOptionsDialog === true).length, 1);
    assert.equal(items.filter((item) => item.hasOptionsDialog === undefined).length, items.length - 1);
  } finally { await rig.close(); }
});

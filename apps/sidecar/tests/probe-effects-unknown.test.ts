/** A project read that did not ask for the effects census says "unknown" with an empty list; the sidecar must not mistake that for an empty install. */
import type { JsonObject } from "@extynt/decode";
import { authorization, hostCensus, mutableSnapshot, sidecarFor, token } from "./sidecar-fixture.js";
import assert from "node:assert/strict";
import test from "node:test";

type Started = { sidecar: ReturnType<typeof sidecarFor>; post: <T>(path: string, value: T) => Promise<Response> };
async function start(t: { after: (fn: () => void | Promise<void>) => void }): Promise<Started> {
  const sidecar = sidecarFor({ port: 0, token, panelSessionId: "panel-effects", quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`, json = { ...authorization, "content-type": "application/json" };
  return { sidecar, post: (path, value) => fetch(`${base}${path}`, { method: "POST", headers: json, body: JSON.stringify(value) }) };
}
const read = (requestId: string, result: JsonObject) => { const base = mutableSnapshot(requestId); return { ...base, result: { ...base.result, ...result } }; };
const unknownEffects = { installedEffects: [], inventoryTruncated: false, capabilityEnumeration: { effects: "unknown", presets: "unknown", commands: "unsupported" } };

test("a read without the census leaves the inventory unset: no 'no effects installed' conclusion", async (t) => {
  const h = await start(t);
  assert.equal((await h.post("/v1/snapshots", read("no-census-1", unknownEffects))).status, 201);
  assert.equal(h.sidecar.inventory, undefined, "nothing was learned about the install");
  assert.equal((await h.post("/v1/snapshots", read("no-census-2", {}))).status, 201, "an older probe that says nothing at all still falls back to what the project uses");
  assert.notEqual(h.sidecar.inventory, undefined);
});

test("a read without the census does not overwrite an inventory a census or an earlier read gave", async (t) => {
  const h = await start(t);
  assert.equal((await h.post("/v1/host-census", hostCensus(5))).status, 201);
  const census = h.sidecar.inventory;
  assert.equal(census?.items.length, 5);
  await h.post("/v1/snapshots", read("no-census-3", unknownEffects));
  assert.strictEqual(h.sidecar.inventory, census);
  const withEffects = await start(t);
  await withEffects.post("/v1/snapshots", read("census-rides-along", { installedEffects: [{ matchName: "ADBE Blur", displayName: "Blur" }], capabilityEnumeration: { effects: "enumerable" } }));
  assert.equal(withEffects.sidecar.inventory?.items.length, 1, "a read that carried the census still seeds the inventory");
});

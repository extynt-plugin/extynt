// An externally proposed plan reaches the host: its first apply-begin starts the host command, the same as a plan from the panel.
import assert from "node:assert/strict";
import test from "node:test";
import { readJson, textOf } from "./http-json.js";
import type { JsonObject } from "./http-json.js";
import { authorization, claimResponse, mutableSnapshot, sidecarFor, token } from "./sidecar-fixture.js";

test("an externally proposed plan's first apply-begin starts the host command", async (t) => {
  const sidecar = sidecarFor({ port: 0, token });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  await fetch(`${base}/v1/snapshots`, {
    method: "POST", headers: { ...authorization, "content-type": "application/json" },
    body: JSON.stringify(mutableSnapshot("external-apply")),
  });
  const call = async (name: string, args: JsonObject) => readJson(await fetch(`${base}/v1/mcp/tools/call`, {
    method: "POST", headers: { ...authorization, "content-type": "application/json", "x-ae-client": "agent" },
    body: JSON.stringify({ name, arguments: args }),
  }));
  const proposed = await call("ae_propose_plan", {
    summary: "Rename a layer", operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name: "Renamed" }],
  });
  const planId = textOf(proposed, "data.planId");
  const approved = await call("ae_approve_plan", { planId, acknowledgeUnverified: true, waitSeconds: 0 });
  assert.equal(textOf(approved, "data.status"), "approved");
  const claimed = await readJson(claimResponse(sidecar));
  assert.equal(textOf(claimed, "item.planId"), planId);
  const begin = () => fetch(`${base}/v1/pipeline`, {
    method: "POST", headers: { ...authorization, "content-type": "application/json" },
    body: JSON.stringify({ event: "apply-begin", detail: `${planId} 1 operations` }),
  });
  const first = await begin();
  assert.equal(first.status, 200);
  assert.deepEqual(await readJson(first), { ok: true }, "the first begin must let the panel run After Effects");
  const duplicate = await begin();
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await readJson(duplicate), { ok: true, idempotent: true, alreadyExecuting: true });
});

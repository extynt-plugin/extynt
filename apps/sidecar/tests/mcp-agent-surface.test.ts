/** External agents author with plan ids; the in-panel agent's queue and workflow completion are refused to them. */
import type { JsonObject } from "@extynt/decode";
import { fieldOf, readJson, recordsOf, textOf } from "./http-json.js";
import { authorization, mutableSnapshot, sidecarFor, token } from "./sidecar-fixture.js";
import assert from "node:assert/strict";
import test from "node:test";

test("an external agent cannot write into the panel agent's queue or complete its workflow", async (t) => {
  const sidecar = sidecarFor({ port: 0, token, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  await fetch(`${base}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("mcp-surface")) });
  const call = (name: string, headers: Record<string, string>) => fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", ...headers }, body: JSON.stringify({ name, arguments: { operations: [{ type: "set_layer_name", target: { layerId: "layer-1" }, name: "Hero" }] } }) });
  for (const name of ["ae_queue_add", "ae_queue_fix", "ae_queue_finish", "ae_workflow_complete"]) {
    const refused = await call(name, { "x-ae-client": "agent" });
    assert.equal(refused.status, 422, name);
    assert.equal(textOf(await readJson(refused), "error.code"), "PANEL_AGENT_ONLY", name);
  }
  const listed = await readJson(await fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", "x-ae-client": "agent" }, body: JSON.stringify({ name: "ae_list_plans", arguments: {} }) }));
  assert.equal(fieldOf(listed, "ok"), true, "plan-id tools stay available to external agents");
});

test("effect value notes are on the agent surface, are not a project write, and need no snapshot", async (t) => {
  const sidecar = sidecarFor({ port: 0, token, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  const call = (name: string, args: JsonObject) => fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", "x-ae-client": "agent" }, body: JSON.stringify({ name, arguments: args }) });
  const read = await call("ae_read_effect_notes", { matchName: "ADBE Gaussian Blur 2" });
  assert.equal(read.status, 422, "no census yet: the effect is unknown, not a missing snapshot");
  assert.equal(textOf(await readJson(read), "error.code"), "EFFECT_NOTES_UNKNOWN_EFFECT");
  const write = await call("ae_write_effect_note", { matchName: "ADBE Gaussian Blur 2", text: "A guess.", expectedNoteIds: [] });
  assert.equal(write.status, 422);
  assert.equal(textOf(await readJson(write), "error.code"), "EFFECT_NOTES_UNKNOWN_EFFECT");
  const listed = await readJson(await fetch(`${base}/v1/mcp/tools`, { headers: authorization }));
  const advertised = recordsOf(listed, "tools").map((tool) => textOf(tool, "name"));
  for (const name of ["ae_read_effect_notes", "ae_write_effect_note"]) assert.ok(advertised.includes(name), `${name} is advertised`);
});

/** A plan the sidecar no longer holds answers with the reason, not a bare "not found": after its own restart, and after After Effects started a new session. The crash case never stops the first sidecar, so only what its last beat wrote can speak. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { type JsonValue } from "@extynt/decode";
import type { ReadOnlySidecar } from "../src/server.js";
import { fieldOf, listOf, readJson, recordOf, textOf } from "./http-json.js";
import { authorization, mutableSnapshot, sidecarFor, token } from "./sidecar-fixture.js";

interface Rig { sidecar: ReadOnlySidecar; call: (name: string, args?: Readonly<Record<string, JsonValue>>, agent?: boolean) => Promise<ReturnType<typeof recordOf>>; pair: (instance: string) => Promise<void>; snapshot: (probe: string) => Promise<void> }

async function open(stateDirectory: string): Promise<Rig> {
  const sidecar = sidecarFor({ port: 0, token, stateDirectory, panelSessionId: "panel-ledger", now: () => new Date("2026-10-05T12:00:00.000Z") });
  const address = await sidecar.start(), base = `http://${address.host}:${address.port}`, json = { ...authorization, "content-type": "application/json" };
  let instance: Record<string, string> = {};
  return {
    sidecar,
    pair: async (id) => { instance = { "X-AE-Panel-Instance": id }; await fetch(`${base}/v1/pair`, { headers: { ...authorization, ...instance } }); },
    snapshot: async (probe) => { await fetch(`${base}/v1/snapshots`, { method: "POST", headers: { ...json, ...instance }, body: JSON.stringify(mutableSnapshot(probe)) }); },
    call: async (name, args = {}, agent = false) => recordOf(await readJson(await fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: { ...json, ...(agent ? { "X-AE-Client": "agent" } : {}) }, body: JSON.stringify({ name, arguments: agent ? { waitSeconds: 0, acknowledgeUnverified: true, ...args } : args }) })), ""),
  };
}

const directory = () => mkdtempSync(join(tmpdir(), "ae-ledger-"));

test("a plan prepared before a sidecar restart answers with why it is gone, and the list shows it discarded", async () => {
  const stateDirectory = directory(), first = await open(stateDirectory);
  await first.snapshot("probe-before");
  const planId = textOf(await first.call("ae_prepare_change"), "data.planId");
  await first.sidecar.stop();

  const second = await open(stateDirectory);
  try {
    await second.snapshot("probe-after");
    for (const name of ["ae_get_plan_status", "ae_approve_plan", "ae_recall_plan"]) {
      const answer = await second.call(name, { planId });
      assert.equal(answer.ok, false, name);
      assert.equal(textOf(answer, "error.code"), "PLAN_EXPIRED_BY_RESTART", name);
      assert.match(textOf(answer, "error.message"), /sidecar restarted before it was approved; nothing was changed\. Propose it again\./, name);
    }
    const listed = listOf(await second.call("ae_list_plans"), "data").find((row) => textOf(row, "planId") === planId);
    assert.equal(textOf(listed, "status"), "cancelled");
    assert.match(textOf(listed, "droppedBecause"), /sidecar restarted/);
    assert.equal(textOf(await second.call("ae_get_plan_status", { planId: "plan-never-made" }), "error.code"), "PLAN_NOT_FOUND");
  } finally { await second.sidecar.stop(); }
});

test("a crash between beats still explains the plan, with the phase the last beat saw", async () => {
  const stateDirectory = directory(), first = await open(stateDirectory);
  await first.snapshot("probe-crash");
  const planId = textOf(await first.call("ae_prepare_change"), "data.planId");
  assert.equal(fieldOf(await first.call("ae_approve_plan", { planId }, true), "data.mailbox.queued"), true);
  first.sidecar.planLedger.sync(first.sidecar.plans);
  const second = await open(stateDirectory);
  try {
    await second.snapshot("probe-after-crash");
    const answer = await second.call("ae_get_plan_status", { planId });
    assert.equal(textOf(answer, "error.code"), "PLAN_EXPIRED_BY_RESTART");
    assert.match(textOf(answer, "error.message"), /before it was applied; nothing was changed/);
  } finally { await second.sidecar.stop(); await first.sidecar.stop(); }
});

test("an approved plan still queued when After Effects starts a new session is dropped with a reason and a plan.dropped event", async () => {
  const stateDirectory = directory(), rig = await open(stateDirectory);
  try {
    await rig.pair("panel-a");
    await rig.snapshot("probe-session-a");
    const planId = textOf(await rig.call("ae_prepare_change"), "data.planId");
    assert.equal(fieldOf(await rig.call("ae_approve_plan", { planId }, true), "data.mailbox.queued"), true);
    assert.equal(rig.sidecar.plans.get(planId)?.status, "approved");

    await rig.pair("panel-b");
    await rig.snapshot("probe-session-b");
    assert.equal(rig.sidecar.plans.has(planId), false, "a plan is never carried into the new session");
    const answer = await rig.call("ae_get_plan_status", { planId });
    assert.equal(textOf(answer, "error.code"), "PLAN_DROPPED");
    assert.match(textOf(answer, "error.message"), /After Effects started a new session.*before it was applied; nothing was changed, and a plan is never applied to a project opened afterwards\. Propose it again\./);
    const events = readFileSync(join(stateDirectory, "pipeline.log"), "utf8").split("\n").filter((line) => line.includes('"event":"plan.dropped"')).map((line) => recordOf(JSON.parse(line), ""));
    assert.equal(events.length, 1);
    assert.equal(textOf(events[0], "planId"), planId);
    assert.equal(textOf(events[0], "reason"), "host-session");
    assert.equal(textOf(events[0], "status"), "approved");
  } finally { await rig.sidecar.stop(); }
});

test("a finished plan lost to a restart says it had finished, never that nothing changed", async () => {
  const stateDirectory = directory(), first = await open(stateDirectory);
  await first.snapshot("probe-finished");
  const planId = textOf(await first.call("ae_prepare_change"), "data.planId");
  const record = first.sidecar.plans.get(planId);
  if (!record) throw new Error("the prepared plan is held");
  record.status = "applied";
  await first.sidecar.stop();
  const second = await open(stateDirectory);
  try {
    await second.snapshot("probe-after-finished");
    const answer = await second.call("ae_get_plan_status", { planId });
    assert.equal(textOf(answer, "error.code"), "PLAN_EXPIRED_BY_RESTART");
    assert.match(textOf(answer, "error.message"), /had finished before extynt's sidecar restarted/);
    assert.equal(listOf(await second.call("ae_list_plans"), "data").some((row) => textOf(row, "planId") === planId), false, "only plans that never ran are listed as discarded");
  } finally { await second.sidecar.stop(); }
});

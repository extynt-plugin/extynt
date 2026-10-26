/** After Effects' script engine has no JSON for its first seconds: the plugin refuses host calls as not ready, and the sidecar waits instead of reporting a failure. */
import assert from "node:assert/strict";
import test from "node:test";
import { ok, refuse, toWire } from "@extynt/fake-plugin";
import { censusAnswer } from "./sidecar-fixture.js";
import { nativeRig, until } from "./native-rig.js";
import { present } from "./present.js";

const NOT_READY = () => refuse("SCRIPT_ENGINE_NOT_READY", "aeHostCensus was not run: the script engine is not ready (JSON is not defined yet)");
const FAST = { stepMs: 10, budgetMs: 400 };

test("a census made before the script engine is ready succeeds once it is, with no failure shown and the link never stalled", async (t) => {
  let calls = 0;
  const rig = await nativeRig(t, { sidecar: { hostReadyRetry: FAST }, plugin: { hostCalls: { aeHostCensus: (args) => (++calls <= 3 ? NOT_READY() : ok(toWire(censusAnswer(args, 2)))) } } });
  const states: string[] = [];
  rig.sidecar.nativeHost?.link.onChange((status) => { states.push(status.state); });
  await until(() => rig.sidecar.hostFacts.checks.census?.ok === true);
  assert.equal(calls, 4);
  assert.equal(rig.sidecar.panel.lastError, null);
  assert.equal(rig.sidecar.hostFacts.checks.census?.ok, true);
  assert.ok(!states.includes("stalled"), JSON.stringify(states));
  assert.ok(!rig.logged.some((entry) => entry.event === "host.census-failed" || entry.event === "host.census-retry"));
});

test("a census that never becomes ready is reported with the not-ready code once the budget is spent, and not retried again", async (t) => {
  let calls = 0;
  const rig = await nativeRig(t, { sidecar: { hostReadyRetry: { stepMs: 10, budgetMs: 120 } }, plugin: { hostCalls: { aeHostCensus: () => { calls += 1; return NOT_READY(); } } } });
  await until(() => rig.sidecar.panel.lastError !== null);
  assert.equal(rig.sidecar.panel.lastError?.code, "SCRIPT_ENGINE_NOT_READY");
  const failed = rig.logged.find((entry) => entry.event === "host.census-failed");
  assert.equal(failed?.fields.code, "SCRIPT_ENGINE_NOT_READY");
  assert.match(String(failed?.fields.message), /not ready/);
  assert.equal(rig.sidecar.hostFacts.checks.census?.ok, false);
  assert.ok(calls >= 2, `${calls} attempts`);
  assert.equal(rig.sidecar.hostLink.status().state, "online");
});

test("an apply refused as not ready runs once the engine is ready, and is verified", async (t) => {
  const rig = await nativeRig(t, { sidecar: { hostReadyRetry: FAST } });
  const applied = present(rig.plugin.hostCalls.get("aeApplyPlan"));
  let refused = 0;
  rig.plugin.hostCalls.set("aeApplyPlan", (args, request, plugin) => (++refused <= 2 ? refuse("SCRIPT_ENGINE_NOT_READY", "aeApplyPlan was not run") : applied(args, request, plugin)));
  const planId = await rig.proposeRename();
  rig.setLive();
  await rig.agent("ae_approve_plan", { planId });
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
  assert.equal(rig.sidecar.plans.get(planId)?.status, "verified");
  assert.equal(refused, 3);
});

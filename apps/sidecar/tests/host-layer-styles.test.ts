/** Whether the Layer Style menu commands run is a host fact the sidecar holds before the model authors: probed, re-probed, and learned from a refused apply. */
import assert from "node:assert/strict";
import test from "node:test";
import { array, decodeOrThrow, object, optional, string } from "@extynt/decode";
import { ok, toWire, type HostCallHandler } from "@extynt/fake-plugin";
import { FEATURES_REASK_MS, queueFeaturesProbe } from "../src/host/run-census.js";
import { isLayerStylesInert, newHostFacts, noteLayerStyles, pruneHostFacts } from "../src/host/facts.js";
import { fieldOf } from "./http-json.js";
import { nativeRig, until } from "./native-rig.js";
import { censusAnswer } from "./sidecar-fixture.js";

const FEATURES_ONLY = '["features"]';
const entryIds = array(object({ id: optional(string()) }));

const featuresAnswer = (args: Parameters<HostCallHandler>[0], live: boolean | null) => JSON.stringify(args.parts) !== FEATURES_ONLY ? ok(toWire(censusAnswer(args))) : ok(JSON.stringify({ schemaVersion: "0.1", ok: true, requestId: args.requestId, result: { part: "features", layerStyleCommandsLive: live }, warnings: [] }));

test("a tool context built for a connected host probes the Layer Styles commands, and an inert menu is held as unavailable", async (t) => {
  const rig = await nativeRig(t);
  const asked: string[] = [];
  rig.plugin.hostCalls.set("aeHostCensus", (args) => { if (JSON.stringify(args.parts) === FEATURES_ONLY) asked.push(FEATURES_ONLY); return featuresAnswer(args, false); });
  await rig.agent("ae_search_native_operations", { query: "glow" });
  await until(() => rig.sidecar.hostFacts.layerStyles.state === "unavailable");
  assert.deepEqual(asked, [FEATURES_ONLY]);
  const found = await rig.agent("ae_search_native_operations", { query: "layer style drop shadow glow" });
  assert.equal(decodeOrThrow(entryIds, fieldOf(found.body, "data.entries")).some((entry) => entry.id === "layer-styles.ensure"), false, "the model is not offered what the session cannot do");
});

test("a live menu is held as available and is not asked about again", async (t) => {
  const rig = await nativeRig(t);
  let asks = 0;
  rig.plugin.hostCalls.set("aeHostCensus", (args) => { if (JSON.stringify(args.parts) === FEATURES_ONLY) asks += 1; return featuresAnswer(args, true); });
  await rig.agent("ae_search_native_operations", { query: "glow" });
  await until(() => rig.sidecar.hostFacts.layerStyles.state === "available");
  await rig.agent("ae_search_native_operations", { query: "glow" });
  assert.equal(asks, 1);
});

test("a probe that cannot tell leaves the held fact alone", async (t) => {
  const rig = await nativeRig(t);
  noteLayerStyles(rig.sidecar.hostFacts, false, 1);
  rig.sidecar.hostFacts.layerStyles.at = null;
  rig.plugin.hostCalls.set("aeHostCensus", (args) => featuresAnswer(args, null));
  await rig.agent("ae_search_native_operations", { query: "glow" });
  await until(() => !rig.sidecar.hostFacts.layerStyles.probing && rig.sidecar.hostFacts.layerStyles.at !== null);
  assert.equal(rig.sidecar.hostFacts.layerStyles.state, "unavailable");
});

test("one apply refused with LAYER_STYLES_UNSUPPORTED teaches the sidecar for the session", async (t) => {
  const rig = await nativeRig(t);
  const message = "LAYER_STYLES_UNSUPPORTED: Layer Style menu commands are not available in this After Effects session. Use ensure_effect instead: ADBE Glo2 for a glow.";
  rig.plugin.hostCalls.set("aeApplyPlan", () => ok(JSON.stringify({ ok: false, mayHaveMutated: false, mutationState: "not-applied", error: { code: "LAYER_STYLES_UNSUPPORTED", message } })));
  const planId = await rig.proposeRename();
  rig.setLive();
  assert.equal(rig.sidecar.hostFacts.layerStyles.state, "unknown");
  await rig.agent("ae_approve_plan", { planId });
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
  assert.equal(rig.sidecar.hostFacts.layerStyles.state, "unavailable");
});

test("only the inert-menu refusal counts, not a per-layer Layer Styles refusal", () => {
  assert.equal(isLayerStylesInert({ code: "LAYER_STYLES_UNSUPPORTED", message: "Layer Style menu commands are not available in this After Effects session." }), true);
  assert.equal(isLayerStylesInert({ code: "LAYER_STYLES_UNSUPPORTED", message: "Layer Styles do not apply to camera layers." }), false);
  assert.equal(isLayerStylesInert({ code: "STALE_STAMP", message: "menu commands are not available" }), false);
  assert.equal(isLayerStylesInert(null), false);
});

test("the probe is throttled while the menu is not known live, and a new pairing forgets the fact", () => {
  let nowMs = 1_000_000;
  const state: Parameters<typeof queueFeaturesProbe>[0] = { agentMailbox: [], inFlight: undefined, hostFacts: newHostFacts(), now: () => new Date(nowMs) };
  const queue = () => queueFeaturesProbe(state);
  assert.equal(queue(), true);
  assert.equal(queue(), false, "one waiting probe at a time");
  assert.equal(state.agentMailbox[0]?.approvedData.part, "features");
  state.hostFacts.layerStyles.probing = false;
  nowMs += FEATURES_REASK_MS - 1;
  assert.equal(queue(), false, "asked lately");
  nowMs += 1;
  assert.equal(queue(), true, "the menu can come alive mid-session, so it is asked again");
  noteLayerStyles(state.hostFacts, true, nowMs);
  nowMs += 10 * FEATURES_REASK_MS;
  assert.equal(queue(), false, "a live menu is not asked about again");
  pruneHostFacts(state.hostFacts, []);
  assert.equal(state.hostFacts.layerStyles.state, "unknown", "a new After Effects session starts unknown");
});

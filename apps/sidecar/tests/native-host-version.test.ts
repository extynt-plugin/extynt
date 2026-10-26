/** The connected After Effects is named in the link, ae_status, the panel's host facts and every apply receipt: AE 25 and AE 26 are told apart by typed fields, and a plugin that predates them still pairs. */
import assert from "node:assert/strict";
import test from "node:test";
import { NATIVE_SVG_IMPORTER_MIN_MAJOR, svgImporterRoute } from "@extynt/action-plan";
import { deriveHostIdentity, NATIVE_SVG_MIN_MAJOR } from "@extynt/host-native";
import { briefingNotes } from "../src/agent-briefing.js";
import { fieldOf } from "./http-json.js";
import { nativeRig, until } from "./native-rig.js";

test("an AE 25 plugin is named, unmeasured and routed to the converter, in the link and in ae_status", async (t) => {
  const rig = await nativeRig(t, { plugin: { aeVersion: "25.6.0 (build 41)" } });
  const host = rig.sidecar.hostLink.status().host;
  assert.equal(host?.source, "plugin");
  assert.equal(host?.family, "ae25");
  assert.equal(host?.measured, false);
  assert.equal(host?.capabilities.svgImport, "converter");
  const status = await rig.agent("ae_status");
  assert.equal(fieldOf(status.body, "data.hostIdentity.family"), "ae25");
  assert.equal(fieldOf(status.body, "data.hostIdentity.capabilities.svgImport"), "converter");
  assert.match(String(fieldOf(status.body, "data.hostIdentity.unmeasuredNote")), /not been measured/);
  assert.equal(fieldOf(status.body, "data.pipeline.host.host.family"), "ae25");
});

test("an AE 26 plugin is measured and carries no unmeasured note", async (t) => {
  const rig = await nativeRig(t, { plugin: { aeVersion: "26.5.0 (build 61)" } });
  const status = await rig.agent("ae_status");
  assert.equal(fieldOf(status.body, "data.hostIdentity.family"), "ae26");
  assert.equal(fieldOf(status.body, "data.hostIdentity.measured"), true);
  assert.equal(fieldOf(status.body, "data.hostIdentity.capabilities.svgImport"), "native");
  assert.equal(fieldOf(status.body, "data.hostIdentity.unmeasuredNote"), undefined);
});

test("a plugin that predates the host object still pairs, with an identity derived from its version and marked as derived", async (t) => {
  const rig = await nativeRig(t, { plugin: { aeVersion: "25.0" } });
  rig.plugin.state.reportHost = false;
  rig.plugin.dropConnections();
  await until(() => rig.sidecar.hostLink.status().state !== "online");
  await until(() => rig.sidecar.hostLink.status().state === "online");
  const host = rig.sidecar.hostLink.status().host;
  assert.equal(host?.source, "derived");
  assert.equal(host?.family, "ae25");
  assert.equal(host?.capabilities.expressionText, "unknown");
});

test("an apply receipt names the After Effects it ran on", async (t) => {
  const rig = await nativeRig(t, { plugin: { aeVersion: "25.6.0 (build 41)" } });
  const planId = await rig.proposeRename();
  rig.setLive();
  const approved = await rig.agent("ae_approve_plan", { planId, waitSeconds: 10 });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
  const receipt = rig.sidecar.plans.get(planId)?.receipt;
  assert.deepEqual(receipt?.host, { version: "25.6.0 (build 41)", family: "ae25", measured: false, experimental: false });
  const shown = await rig.agent("ae_get_receipt", { planId });
  assert.equal(fieldOf(shown.body, "data.receipt.host.family"), "ae25");
});

test("an AE 27 plugin is experimental: typed in the link and ae_status, with a note for the agent and a briefing line", async (t) => {
  const rig = await nativeRig(t, { plugin: { aeVersion: "27.1.0 (build 3)" } });
  const host = rig.sidecar.hostLink.status().host;
  assert.equal(host?.family, "newer");
  assert.equal(host?.supported, true);
  assert.equal(host?.measured, false);
  assert.equal(host?.experimental, true);
  const status = await rig.agent("ae_status");
  assert.equal(fieldOf(status.body, "data.hostIdentity.experimental"), true);
  assert.match(String(fieldOf(status.body, "data.hostIdentity.experimentalNote")), /experimental/);
  assert.equal(fieldOf(status.body, "data.pipeline.host.host.experimental"), true);
  assert.match(briefingNotes(host ?? null, ""), /EXPERIMENTAL/);
});

test("a measured or merely unmeasured release is never experimental", async (t) => {
  const rig = await nativeRig(t, { plugin: { aeVersion: "25.6.0 (build 41)" } });
  const status = await rig.agent("ae_status");
  assert.equal(fieldOf(status.body, "data.hostIdentity.experimental"), false);
  assert.equal(fieldOf(status.body, "data.hostIdentity.experimentalNote"), undefined);
  assert.doesNotMatch(briefingNotes(rig.sidecar.hostLink.status().host ?? null, ""), /EXPERIMENTAL/);
  assert.equal(briefingNotes(deriveHostIdentity("26.5.0"), ""), "");
});

test("the SVG threshold is one value on both routing paths, and the revision guard defaults on for 25", () => {
  assert.equal(NATIVE_SVG_MIN_MAJOR, NATIVE_SVG_IMPORTER_MIN_MAJOR);
  for (const version of ["25.6.0", "26.5.0", "27.0.0"]) {
    const route = svgImporterRoute({ hostKey: `After Effects ${version}` });
    assert.equal(route.importer === "converter", deriveHostIdentity(version).capabilities.svgImport === "converter", version);
  }
  assert.equal(deriveHostIdentity("25.6.0").capabilities.revisionGuard, "on");
});

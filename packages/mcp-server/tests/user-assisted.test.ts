// Tests that host-capability search rows and descriptions say which effects are user assisted and why, and mark a custom control as set by hand.
import assert from "node:assert/strict";
import test from "node:test";

import { applyEffectControlEvidence, makeHostProfile, makeInventory } from "@extynt/capability-catalogue";

import { array, decodeOrThrow, object, optional, string } from "@extynt/decode";

import { callTool } from "../src/index.js";
import { payloadOf } from "./support/json-results.js";

const host = { application: "After Effects" as const, version: "26.2.1", buildNumber: "2", platform: "macOS", architecture: "arm64" };
const installed = (matchName: string, displayName: string, hasOptionsDialog?: true) => ({ matchName, displayName, available: true, evidence: [], ...(hasOptionsDialog ? { hasOptionsDialog } : {}) });
const inventory = makeInventory(host, [installed("ADBE Apply Color LUT2", "Apply Color LUT"), installed("ACME Window", "Acme Window"), installed("ACME Wizard", "Acme Wizard", true)]);
const profile = applyEffectControlEvidence(makeHostProfile(inventory), { userAssisted: ["ACME Window"], effects: { "ACME Window": { controls: [{ m: "ACME Window-0001", n: "Options...", t: "CUSTOM_VALUE" }, { m: "ACME Window-0002", n: "Amount", t: "OneD", v: 1, min: 0, max: 10 }] } } });

const searchView = object({ entries: array(object({ matchName: string(), userAssisted: optional(string()), operationStatus: string() })) });
const summaryView = object({ userAssisted: object({ reason: string() }) });
const controlsView = object({ writeShapes: array(string()) });

const searchRows = (query: string) => decodeOrThrow(searchView, payloadOf(callTool("ae_search_host_capabilities", { query }, { hostProfile: profile }))).entries;

test("search rows say which effects are user assisted, and why", () => {
  const lut = searchRows("Apply Color LUT").find((row) => row.matchName === "ADBE Apply Color LUT2");
  assert.equal(lut?.operationStatus, "supported");
  assert.match(lut?.userAssisted ?? "", /^User assisted: Apply Color LUT opens a dialog when it is added\./);
  assert.match(searchRows("Acme Window")[0]?.userAssisted ?? "", /Acme Window held After Effects on a window while this machine was scanned/);
  assert.match(searchRows("Acme Wizard")[0]?.userAssisted ?? "", /Acme Wizard may ask for options when it is added/);
});

test("describe carries the user assisted note and marks a custom control by hand", () => {
  const summary = callTool("ae_describe_host_capability", { id: "host:ACME Window" }, { hostProfile: profile });
  assert.equal(decodeOrThrow(summaryView, payloadOf(summary)).userAssisted.reason, "observed-interactive");
  const controls = callTool("ae_describe_host_capability", { id: "host:ACME Window", detail: "controls" }, { hostProfile: profile });
  const lines = decodeOrThrow(controlsView, payloadOf(controls)).writeShapes;
  assert.match(lines.find((line) => line.startsWith("Options...")) ?? "", /user assisted: .* set it by hand/);
  assert.match(lines.find((line) => line.startsWith("Amount")) ?? "", /one number, 0 to 10/);
});

// Proves ae_status answers without a project, and that facts the sidecar adds ride on the shared answer and take precedence.
import test from "node:test";
import assert from "node:assert/strict";
import { representativeSnapshot } from "@extynt/project-graph";
import { callTool, statusResult } from "../src/index.js";
import { stringAt } from "../src/json.js";
import { payloadOf } from "./support/json-results.js";

test("a status with no project reports connected and nulls instead of failing", () => {
  const answer = statusResult(undefined, {});
  assert.ok(answer.ok);
  assert.equal(answer.snapshotFingerprint, null);
  const data = payloadOf(answer);
  assert.equal(data.connected, true);
  assert.equal(data.projectName, null);
  assert.equal(data.capturedAt, null);
});

test("sidecar facts are added to the status and win over the shared fields", () => {
  const data = payloadOf(callTool("ae_status", {}, { snapshot: representativeSnapshot, statusFacts: { host: "After Effects 26", pipeline: { panel: "online" } } }));
  assert.equal(data.host, "After Effects 26");
  assert.deepEqual(data.pipeline, { panel: "online" });
  assert.equal(stringAt(data, "projectName"), representativeSnapshot.project.name);
});

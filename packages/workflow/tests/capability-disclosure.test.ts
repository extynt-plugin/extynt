// Tests that capability disclosures stay closed, typed and free of executable host detail.

import test from "node:test";
import assert from "node:assert/strict";
import { validateWorkflowCapabilityDisclosure } from "../src/index.js";
import type { WorkflowCapabilityDisclosure } from "../src/index.js";
import { present, throwsCode } from "./fixtures.js";

function disclosure(overrides: Partial<WorkflowCapabilityDisclosure> = {}): WorkflowCapabilityDisclosure {
  return {
    disclosureId: "disclosure-1",
    engineId: "workflow-v1",
    stableCore: ["inspect_project", "observe_snapshot"],
    operationFamilies: [{
      familyId: "layers",
      summary: "Create and update layers.",
      operationTypes: ["create_layer", "set_layer"],
      schemaPackIds: ["layer-pack"],
    }],
    schemaPacks: [{
      schemaPackId: "layer-pack",
      version: "1",
      summary: "Layer operation fields.",
      operationTypes: ["create_layer", "set_layer"],
      fields: [
        { name: "layer_id", type: "id", required: false },
        { name: "name", type: "string", required: true, description: "Layer name." },
      ],
    }],
    ...overrides,
  };
}

test("capability disclosure accepts stable core, family index, and typed schema packs", () => {
  assert.doesNotThrow(() => validateWorkflowCapabilityDisclosure(disclosure()));
});

test("capability disclosure keeps family references closed over known schema packs", () => {
  throwsCode(() => validateWorkflowCapabilityDisclosure(disclosure({
    operationFamilies: [{ ...present(disclosure().operationFamilies[0]), schemaPackIds: ["missing-pack"] }],
  })), "INVALID_EVENT");
});

test("capability disclosure rejects lifecycle bookkeeping and executable host detail", () => {
  throwsCode(() => validateWorkflowCapabilityDisclosure(disclosure({ stableCore: ["receipt"] })), "INVALID_EVENT");
  throwsCode(() => validateWorkflowCapabilityDisclosure(disclosure({
    schemaPacks: [{ ...present(disclosure().schemaPacks[0]), summary: "function () { app.project }" }],
  })), "INVALID_EVENT");
});

test("capability schema fields remain typed, bounded, and closed", () => {
  const basePack = present(disclosure().schemaPacks[0]);
  throwsCode(() => validateWorkflowCapabilityDisclosure(disclosure({
    schemaPacks: [{ ...basePack, fields: [{ name: "kind", type: "enum", required: true }] }],
  })), "INVALID_EVENT");
  throwsCode(() => validateWorkflowCapabilityDisclosure(disclosure({
    schemaPacks: [{ ...basePack, fields: [{ name: "name", type: "string", required: true }, { name: "name", type: "id", required: false }] }],
  })), "INVALID_EVENT");
});

test("capability disclosure permits open-ended typed operation names without recipes", () => {
  assert.doesNotThrow(() => validateWorkflowCapabilityDisclosure(disclosure({
    operationFamilies: [{
      familyId: "custom-family",
      summary: "A provider-defined typed family.",
      operationTypes: ["custom_vector_write"],
      schemaPackIds: ["custom-pack"],
    }],
    schemaPacks: [{
      schemaPackId: "custom-pack",
      version: "2026-09",
      summary: "Typed custom operation fields.",
      operationTypes: ["custom_vector_write"],
      fields: [],
    }],
  })));
});

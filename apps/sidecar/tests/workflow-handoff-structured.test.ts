// A specialist reply that is not a valid handoff is restated by one schema-constrained call when the provider can do it, instead of replaying the thread with a plea to try again.
import assert from "node:assert/strict";
import test from "node:test";
import { MockProvider, type JsonCompletionRequest, type JsonSchemaSpec } from "@extynt/llm";
import { WORKFLOW_OWNER } from "../src/workflow-orchestration.js";
import { handoffSchema } from "../src/workflow-handoff-structured.js";
import { maybeTextOf } from "./http-json.js";
import { mutableSnapshot, sidecarFor, token } from "./sidecar-fixture.js";

const HANDOFF = JSON.stringify({ role: "motion", objective: "Continuous orbit", requirements: ["r"], deliverables: ["d"], constraints: ["c"], verification: ["v"] });

class StructuredSpecialist extends MockProvider {
  public readonly restated: Array<{ readonly request: JsonCompletionRequest; readonly schema: JsonSchemaSpec }> = [];
  public async completeJson(request: JsonCompletionRequest, schema: JsonSchemaSpec): Promise<string> {
    this.restated.push({ request, schema });
    return HANDOFF;
  }
}

test("the handoff schema is closed: the six fields, the role fixed, nothing else", () => {
  const { schema } = handoffSchema("motion");
  assert.deepEqual(schema.required, ["role", "objective", "requirements", "deliverables", "constraints", "verification"]);
  assert.equal(schema.additionalProperties, false);
});

test("an invalid first handoff is restated by a structured call and the thread is not replayed", async () => {
  const provider = new StructuredSpecialist({ script: async () => ({ text: "orbit plan, no json here", toolCalls: [] }) });
  const sidecar = sidecarFor({ token, chatProvider: provider, workflowSpecialistProviders: { motion: provider }, quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot("restated"), receivedAt: "2026-09-22T12:00:00.000Z", bytes: 1 };
  const input = { requestId: "restated", message: "Animate an orbit", history: [], autoApply: true, workflowJobId: "restated", workflowGoalSummary: "Animate an orbit", workflowRole: WORKFLOW_OWNER };
  await sidecar.runAgentTool("ae_consult_specialist", { action: "launch", role: "motion", instruction: "Design continuous motion." }, input, {});
  const waited = await sidecar.runAgentTool("ae_consult_specialist", { action: "wait", role: "motion", waitSeconds: 1 }, input, {});
  assert.equal(maybeTextOf(waited.ok ? waited.data : undefined, "status"), "sleeping");
  assert.equal(provider.calls, 1, "one free reply, no correction round");
  assert.equal(provider.restated.length, 1);
  assert.match(provider.restated[0]?.request.user ?? "", /orbit plan, no json here/);
  assert.equal(provider.restated[0]?.schema.name, "specialist_handoff");
});

test("a structured call that fails falls back to the format correction", async () => {
  let replies = 0;
  const provider = new StructuredSpecialist({ script: async () => ({ text: ++replies === 1 ? "not json" : HANDOFF, toolCalls: [] }) });
  provider.completeJson = async () => { throw new Error("schema refused"); };
  const sidecar = sidecarFor({ token, chatProvider: provider, workflowSpecialistProviders: { motion: provider }, quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot("fallback"), receivedAt: "2026-09-22T12:00:00.000Z", bytes: 1 };
  const input = { requestId: "fallback", message: "Animate an orbit", history: [], autoApply: true, workflowJobId: "fallback", workflowGoalSummary: "Animate an orbit", workflowRole: WORKFLOW_OWNER };
  await sidecar.runAgentTool("ae_consult_specialist", { action: "launch", role: "motion", instruction: "Design continuous motion." }, input, {});
  const waited = await sidecar.runAgentTool("ae_consult_specialist", { action: "wait", role: "motion", waitSeconds: 1 }, input, {});
  assert.equal(maybeTextOf(waited.ok ? waited.data : undefined, "status"), "sleeping");
  assert.equal(provider.calls, 2);
});

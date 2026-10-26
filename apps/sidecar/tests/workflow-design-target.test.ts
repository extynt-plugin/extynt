/** The designer builds in the composition the owner's launch names (a checklist item's comp), not the open one, and the checklist wording says so. */
import assert from "node:assert/strict";
import test from "node:test";
import { MockProvider } from "@extynt/llm";
import { workflowCycleContract } from "../src/workflow-contract.js";
import { setChecklist } from "../src/server-workflow-checklist.js";
import { operationsOf } from "../src/server-workflow-design-receipts.js";
import { objectOf, textOf, type ToolResult } from "../src/server-workflow-operation-json.js";
import { WORKFLOW_OWNER } from "../src/workflow-orchestration.js";
import { present } from "./agent-test-support.js";
import { DESIGN_SVG, mutableSnapshot, settledDesigner, sidecarFor, token } from "./sidecar-fixture.js";

const createsLayer = (record: Parameters<typeof operationsOf>[0]) => operationsOf(record).filter((operation) => operation.type === "create_layer");
const failureOf = (result: ToolResult) => (result.ok ? undefined : result.error);

const CONTRACT = { workflowJobId: "job-1", workflowCycle: 0 } as const;

test("the contract asks for one design per checklist item with its compositionId, and a shared look is a reference, not a comp to nest", () => {
  const checklist = workflowCycleContract({ ...CONTRACT, workflowChecklist: true }) ?? "";
  assert.doesNotMatch(checklist, /once for the whole scene|request whole|passes the user's request whole/);
  assert.match(checklist, /once per checklist item.*compositionId/s);
  assert.match(checklist, /a reference for colour and style that each item's design follows, not a composition to build once and nest/);
  const plain = workflowCycleContract(CONTRACT) ?? "";
  assert.match(plain, /once for the whole scene/);
  assert.doesNotMatch(plain, /compositionId|once per checklist item/);
});

function setup(id: string, designer: MockProvider) {
  const sidecar = sidecarFor({ token, chatProvider: designer, workflowSpecialistProviders: { "visual-scene": designer }, quietAgentLog: true });
  const base = mutableSnapshot(id);
  const main = present(base.result.compositions[0], "composition");
  sidecar.latest = { snapshot: { ...base, result: { ...base.result, activeCompositionId: "comp-1", compositions: [main, { ...main, id: "bar-a", name: "BAR_A" }, { ...main, id: "bar-b", name: "BAR_B" }] } }, receivedAt: "2026-09-24T15:00:00.000Z", bytes: 1 };
  const input = { requestId: id, message: "Bars", history: [], autoApply: false, workflowJobId: id, workflowGoalSummary: "Bars", workflowRole: WORKFLOW_OWNER };
  return { sidecar, input };
}

const buildOnce = () => new MockProvider({ script: (step) => (step.messages.some((message) => message.role === "tool") ? { text: "Built.", toolCalls: [] } : { text: "", toolCalls: [{ id: "build", name: "ae_build_drawing", arguments: { svg: DESIGN_SVG } }] }) });

test("a launch with compositionId builds into that comp while another is open and same-size comps exist", async () => {
  const { sidecar, input } = setup("design-target", buildOnce());
  const launched = await sidecar.runAgentTool("ae_consult_specialist", { action: "launch", role: "visual-scene", instruction: "Draw bar B.", compositionId: "bar-b" }, input, {});
  assert.equal(launched.ok, true);
  await settledDesigner(sidecar, input, "wait");
  const plan = [...sidecar.plans.values()].find((record) => createsLayer(record).length > 0);
  assert.ok(plan, "the drawing was built");
  const targets = createsLayer(plan).map((operation) => textOf(objectOf(operation.target)?.compositionId));
  assert.deepEqual([...new Set(targets)], ["bar-b"]);
});

test("a launch without compositionId still builds into the open composition", async () => {
  const { sidecar, input } = setup("design-no-target", buildOnce());
  await sidecar.runAgentTool("ae_consult_specialist", { action: "launch", role: "visual-scene", instruction: "Draw." }, input, {});
  await settledDesigner(sidecar, input, "wait");
  const plan = [...sidecar.plans.values()].find((record) => createsLayer(record).length > 0);
  assert.ok(plan);
  assert.equal(textOf(objectOf(createsLayer(plan)[0]?.target)?.compositionId), "comp-1");
});

test("a compositionId that is not in the project is refused", async () => {
  const { sidecar, input } = setup("design-bad-target", buildOnce());
  const refused = await sidecar.runAgentTool("ae_consult_specialist", { action: "launch", role: "visual-scene", instruction: "Draw.", compositionId: "nope" }, input, {});
  assert.equal(refused.ok, false);
  assert.equal(failureOf(refused)?.code, "INVALID_SPECIALIST_REQUEST");
  assert.match(failureOf(refused)?.message ?? "", /nope/);
});

test("the design-required refusal speaks per item when the job has a checklist and for the whole scene when it has none", async () => {
  const ask = async (id: string, withChecklist: boolean) => {
    const { sidecar, input } = setup(id, buildOnce());
    if (withChecklist) setChecklist(sidecar, sidecar.workflowCoordinator.jobIdForSeed(id), { raw: [{ id: "bar-01", title: "Bar one" }, { id: "bar-02", title: "Bar two" }, { id: "bar-03", title: "Bar three" }] });
    const result = await sidecar.runAgentTool("ae_queue_add", { operations: [{ type: "create_layer", target: { compositionId: "bar-a", layerId: "__new__:planet" }, layerType: "shape", name: "Planet" }] }, input, { workflowStage: { summary: "Build", operationTypes: ["create_layer"] } });
    assert.equal(result.ok, false);
    return failureOf(result)?.message ?? "";
  };
  const perItem = await ask("refusal-checklist", true);
  assert.match(perItem, /checklist item.*compositionId/s);
  assert.doesNotMatch(perItem, /once for the whole scene|request whole/);
  assert.match(await ask("refusal-plain", false), /once for the whole scene/);
});

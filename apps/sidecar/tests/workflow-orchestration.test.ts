// Tests for specialist orchestration: delegation, owner wake-up, cancellation, completion tools and frame observation evidence.

import assert from "node:assert/strict";
import test from "node:test";
import { MockProvider } from "@extynt/llm";
import { compileCaptureCommand } from "@extynt/host-ae";
import { requiredEvidenceKindsForGoal, successCriteriaForGoal } from "../src/workflow-goal-evidence.js";
import { type JsonValue } from "@extynt/decode";
import type { ReadOnlySidecar } from "../src/server.js";
import { WORKFLOW_OWNER, WORKFLOW_SPECIALIST_REGISTRY, type WorkflowSpecialistRole } from "../src/workflow-orchestration.js";
import { present } from "./agent-test-support.js";
import { fieldOf, maybeTextOf, textOf } from "./http-json.js";
import { authorization, chatTurn, DESIGN_SVG, designerTurn, mutableSnapshot, sidecarFor, token, workflowStageStep, settledDesigner } from "./sidecar-fixture.js";

type ToolOutcome = Awaited<ReturnType<ReadOnlySidecar["runAgentTool"]>>;

const statusOf = (result: ToolOutcome): string | undefined => maybeTextOf(result.ok ? result.data : undefined, "status");
const evidenceIdOf = (result: ToolOutcome, key: string): string => textOf(result.ok ? result.data : undefined, `${key}.evidenceId`);

function currentSnapshot(sidecar: ReadOnlySidecar): { fingerprint: string; revision: string } {
  const { fingerprint, revision } = present(sidecar.normalizedLatest() ?? undefined, "latest snapshot");
  return { fingerprint, revision };
}

function brief(role: WorkflowSpecialistRole, objective: string): string {
  const handoff = JSON.stringify({
    role,
    objective,
    requirements: [`${role} requirement`],
    deliverables: [`${role} deliverable`],
    constraints: [`${role} constraint`],
    verification: [`${role} evidence`],
  });
  return handoff;
}

test("registered specialists are explicit, role-specific, and owner-invoked", async () => {
  const provider = new MockProvider({ answer: brief("visual-scene", "Define editable artwork and occlusion.") });
  const sidecar = sidecarFor({ token, chatProvider: provider, workflowSpecialistProviders: { "visual-scene": provider }, quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot("orchestration"), receivedAt: "2026-09-22T12:00:00.000Z", bytes: 1 };
  assert.equal(provider.calls, 0, "specialists are not launched as workflow preflight");
  assert.deepEqual(WORKFLOW_SPECIALIST_REGISTRY.map((entry) => entry.role), ["visual-scene", "motion", "execution", "planner", "reviewer", "expression"]);
  assert.equal(WORKFLOW_SPECIALIST_REGISTRY.every((entry) => /MUST/.test(entry.rules)), true);
  const input = { requestId: "orchestration", message: "Animate a masked ring", history: [], autoApply: true, workflowJobId: "orchestration", workflowGoalSummary: "Animate a masked ring", workflowRole: WORKFLOW_OWNER };
  const launched = await sidecar.runAgentTool("ae_consult_specialist", { action: "launch", role: "visual-scene", instruction: "Specify the editable layer stack and occlusion." }, input, {});
  assert.equal(launched.ok, true);
  const waited = await settledDesigner(sidecar, input, "wait");
  assert.equal(waited.ok, true);
  assert.equal(statusOf(waited), "sleeping");
  assert.match(JSON.stringify(provider.stepInputs[0]?.messages), /Current bounded project context/);
  assert.equal(sidecar.chatProgress.has("orchestration"), false, "a specialist reporting outside a live turn never invents a progress line");
});

test("a failed specialist turn stays correctable in the same persistent transcript", async () => {
  let call = 0;
  const provider = new MockProvider({ script: async () => ({ text: ++call <= 2 ? "not json" : brief("motion", "Corrected continuous motion."), toolCalls: [] }) });
  const sidecar = sidecarFor({ token, chatProvider: provider, workflowSpecialistProviders: { motion: provider }, quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot("correction"), receivedAt: "2026-09-22T12:00:00.000Z", bytes: 1 };
  const input = { requestId: "correction", message: "Animate an orbit", history: [], autoApply: true, workflowJobId: "correction", workflowGoalSummary: "Animate an orbit", workflowRole: WORKFLOW_OWNER };
  await sidecar.runAgentTool("ae_consult_specialist", { action: "launch", role: "motion", instruction: "Design continuous motion." }, input, {});
  const failed = await sidecar.runAgentTool("ae_consult_specialist", { action: "wait", role: "motion", waitSeconds: 1 }, input, {});
  assert.equal(statusOf(failed), "failed");
  const corrected = await sidecar.runAgentTool("ae_consult_specialist", { action: "message", role: "motion", instruction: "Return the required typed JSON and fix the continuity plan." }, input, {});
  assert.equal(corrected.ok, true, "an invalid first handoff does not make the specialist thread unusable");
  const ready = await sidecar.runAgentTool("ae_consult_specialist", { action: "wait", role: "motion", waitSeconds: 1 }, input, {});
  assert.equal(fieldOf(ready.ok ? ready.data : undefined, "turns"), 2);
  assert.ok((provider.stepInputs[2]?.messages.length ?? 0) >= 5, "the owner correction includes both failed format attempts");
  assert.match(JSON.stringify(provider.stepInputs[2]?.messages), /Current bounded project context/);
});

test("a completed specialist wakes the same owner loop before it can one-shot a final answer", async () => {
  const specialist = new MockProvider({ script: async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { text: brief("motion", "A continuous orbit."), toolCalls: [] };
  } });
  let ownerStep = 0;
  const owner = new MockProvider({ script: async () => {
    ownerStep += 1;
    if (ownerStep === 1) return { text: "I will ask motion.", toolCalls: [{ id: "launch", name: "ae_consult_specialist", arguments: { action: "launch", role: "motion", instruction: "Define the trajectory." } }] };
    if (ownerStep === 2) return { text: "Premature final answer.", toolCalls: [] };
    if (ownerStep === 3) return { text: "Reading the completed handoff.", toolCalls: [{ id: "status", name: "ae_consult_specialist", arguments: { action: "status", role: "motion" } }] };
    return { text: "Final answer after specialist review.", toolCalls: [] };
  } });
  const sidecar = sidecarFor({ token, chatProvider: owner, workflowSpecialistProviders: { motion: specialist }, quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot("owner-wake"), receivedAt: "2026-09-22T12:00:00.000Z", bytes: 1 };
  const result = await sidecar.runChatAgent(owner, { requestId: "owner-wake", message: "How should this orbit move?", history: [], autoApply: true, workflowJobId: "owner-wake", workflowGoalSummary: "How should this orbit move?", workflowCycle: 0, workflowRole: WORKFLOW_OWNER });
  assert.equal(result?.answer, "Final answer after specialist review.");
  assert.equal(owner.calls, 4, "the asynchronous completion wakes and resumes the existing owner loop");
  assert.equal(result?.tools.some((entry) => entry.name === "ae_consult_specialist" && entry.ok), true);
});

test("a specialist never reasons past medium, whatever effort the slot asks for", async () => {
  for (const [configured, expected] of [["max", "medium"], ["low", "low"]] as const) {
    const provider = new MockProvider({ answer: brief("motion", "Bounded handoff.") });
    provider.config.reasoningEffort = configured;
    const sidecar = sidecarFor({ token, chatProvider: provider, workflowSpecialistProviders: { motion: provider }, quietAgentLog: true });
    sidecar.latest = { snapshot: mutableSnapshot(`specialist-effort-${configured}`), receivedAt: "2026-09-22T12:00:00.000Z", bytes: 1 };
    const input = { requestId: `specialist-effort-${configured}`, message: "Animate an orbit", history: [], autoApply: true, workflowJobId: `specialist-effort-${configured}`, workflowGoalSummary: "Animate an orbit", workflowRole: WORKFLOW_OWNER };
    await sidecar.runAgentTool("ae_consult_specialist", { action: "launch", role: "motion", instruction: "Design the motion." }, input, {});
    await sidecar.runAgentTool("ae_consult_specialist", { action: "wait", role: "motion", waitSeconds: 1 }, input, {});
    assert.equal(provider.stepInputs[0]?.reasoningEffort, expected, `a ${configured} slot runs its specialist at ${expected}`);
  }
});

test("a completed specialist wakes the owner once, not on every prose answer", async () => {
  const specialist = new MockProvider({ script: async () => ({ text: brief("motion", "A continuous orbit."), toolCalls: [] }) });
  let ownerStep = 0;
  const owner = new MockProvider({ script: async () => {
    ownerStep += 1;
    if (ownerStep === 1) return { text: "", toolCalls: [{ id: "launch", name: "ae_consult_specialist", arguments: { action: "launch", role: "motion", instruction: "Define the trajectory." } }] };
    return { text: ownerStep === 2 ? "Premature final answer." : "Answering without reading it.", toolCalls: [] };
  } });
  const sidecar = sidecarFor({ token, chatProvider: owner, workflowSpecialistProviders: { motion: specialist }, quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot("owner-wake-once"), receivedAt: "2026-09-22T12:00:00.000Z", bytes: 1 };
  const result = await sidecar.runChatAgent(owner, { requestId: "owner-wake-once", message: "How should this orbit move?", history: [], autoApply: true, workflowJobId: "owner-wake-once", workflowGoalSummary: "How should this orbit move?", workflowCycle: 0, workflowRole: WORKFLOW_OWNER });
  assert.equal(owner.calls, 3, "one wake for the one completed turn, then the owner's answer stands");
  assert.equal(result?.answer, "Answering without reading it.");
});

test("a specialist turn the provider never answered is marked as the sidecar's, not the specialist's words", async () => {
  let call = 0;
  const provider = new MockProvider({ script: async () => { call += 1; if (call === 1) throw new Error("provider unreachable"); return { text: brief("motion", "Recovered."), toolCalls: [] }; } });
  const sidecar = sidecarFor({ token, chatProvider: provider, workflowSpecialistProviders: { motion: provider }, quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot("specialist-unreachable"), receivedAt: "2026-09-22T12:00:00.000Z", bytes: 1 };
  const input = { requestId: "specialist-unreachable", message: "Animate an orbit", history: [], autoApply: true, workflowJobId: "specialist-unreachable", workflowGoalSummary: "Animate an orbit", workflowRole: WORKFLOW_OWNER };
  await sidecar.runAgentTool("ae_consult_specialist", { action: "launch", role: "motion", instruction: "Design continuous motion." }, input, {});
  const failed = await sidecar.runAgentTool("ae_consult_specialist", { action: "wait", role: "motion", waitSeconds: 1 }, input, {});
  assert.equal(statusOf(failed), "failed");
  await sidecar.runAgentTool("ae_consult_specialist", { action: "message", role: "motion", instruction: "Try again." }, input, {});
  await sidecar.runAgentTool("ae_consult_specialist", { action: "wait", role: "motion", waitSeconds: 1 }, input, {});
  const replayed = provider.stepInputs[1]?.messages.find((message) => message.role === "assistant");
  assert.match(replayed?.content ?? "", /^\[sidecar: this turn ended without a handoff: provider unreachable\]$/, "the retry sees what happened, and not as something it said");
});

test("a job that ends with nothing left to continue it releases its specialists", async (t) => {
  const specialist = new MockProvider({ script: async () => ({ text: brief("motion", "A continuous orbit."), toolCalls: [] }) });
  const owner = new MockProvider({ script: async (input) => {
    const consulted = input.messages.filter((message) => message.role === "tool" && message.name === "ae_consult_specialist").length;
    if (!input.messages.some((message) => message.role === "tool" && message.name === "ae_select_workflow_stage")) return workflowStageStep("release", "Animate the orbit", ["set_layer_property"]);
    if (consulted === 0) return { text: "", toolCalls: [{ id: "launch", name: "ae_consult_specialist", arguments: { action: "launch", role: "motion", instruction: "Define the trajectory." } }] };
    if (consulted === 1) return { text: "", toolCalls: [{ id: "wait", name: "ae_consult_specialist", arguments: { action: "wait", role: "motion", waitSeconds: 5 } }] };
    return { text: "I stopped before queueing anything.", toolCalls: [] };
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: owner, workflowSpecialistProviders: { motion: specialist }, quietAgentLog: true });
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-release")) });
  await chatTurn(address, "animate the orbit");
  const job = Object.values(sidecar.workflowCoordinator.workflowStore.getState().jobs)[0];
  assert.equal(job?.status, "blocked", "the cycle ended in prose, so the job is blocked with no receipt to reopen it");
  assert.equal(specialist.calls, 1, "the specialist did run for this job");
  assert.equal(sidecar.workflowSpecialistSessions.size, 0, "its transcript is not kept for a job that cannot continue");
  assert.equal(sidecar.workflowOrchestrations.size, 0, "nor its orchestration bundle");
});

test("workflow cancellation aborts specialists by coordinator job id and ignores late settlement", async () => {
  let specialistSignal: AbortSignal | undefined;
  const specialist = new MockProvider({ script: async (step) => {
    specialistSignal = step.signal;
    await new Promise<void>((_resolve, reject) => step.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
    return { text: brief("execution", "late"), toolCalls: [] };
  } });
  const sidecar = sidecarFor({ token, chatProvider: specialist, workflowSpecialistProviders: { execution: specialist }, quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot("cancel-specialist"), receivedAt: "2026-09-22T12:00:00.000Z", bytes: 1 };
  const jobId = sidecar.workflowCoordinator.openJob("cancel-specialist", "Plan a larger edit");
  const input = { requestId: "cancel-specialist", message: "Plan it", history: [], autoApply: true, workflowJobId: "cancel-specialist", workflowGoalSummary: "Plan a larger edit", workflowRole: WORKFLOW_OWNER };
  await sidecar.runAgentTool("ae_consult_specialist", { action: "launch", role: "execution", instruction: "Propose stages." }, input, {});
  sidecar.cancelWorkflowJob(jobId);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(specialistSignal?.aborted, true);
  assert.equal(sidecar.workflowSpecialistSessions.has(jobId), false);
  assert.equal(sidecar.workflowOrchestrations.has(jobId), false);
});

test("sidecar-owned criteria require rendered and temporal evidence for design motion", () => {
  assert.deepEqual(requiredEvidenceKindsForGoal("Polish the visual design and animate a smooth orbit"), ["visual", "temporal"]);
  assert.deepEqual(successCriteriaForGoal("Polish the visual design and animate a smooth orbit").map((criterion) => [criterion.criterionId, criterion.requiredEvidenceKind]), [["goal-visual", "visual"], ["goal-temporal", "temporal"]]);
  assert.deepEqual(successCriteriaForGoal("Rename the selected layer"), [{ criterionId: "goal-observed", description: "The original user goal is satisfied by verified host evidence." }]);
});

test("workflow submission tools reject callers without orchestrator-validator authority", async () => {
  const sidecar = sidecarFor({ token, chatProvider: new MockProvider(), quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot("owner-boundary"), receivedAt: "2026-09-22T12:00:00.000Z", bytes: 1 };
  sidecar.workflowCoordinator?.openJob("owner-boundary", "Rename the selected layer");
  const input = { requestId: "owner-boundary", message: "Rename it", history: [], autoApply: true, workflowJobId: "owner-boundary", workflowGoalSummary: "Rename it", workflowCycle: 0 };
  const denied = await sidecar.runAgentTool("ae_queue_add", { summary: "Rename", operations: [] }, input, {});
  assert.equal(denied.ok, false);
  assert.equal(denied.ok ? undefined : denied.error.code, "WORKFLOW_OWNER_REQUIRED");
  const directDenied = await sidecar.runNativeAgentTool("ae_queue_add", { summary: "Rename", operations: [] }, input);
  assert.equal(directDenied.ok, false, "the lower-level execution capability cannot bypass owner admission");
  assert.equal(directDenied.ok ? undefined : directDenied.error.code, "WORKFLOW_OWNER_REQUIRED");

  const ownerInput = { ...input, workflowRole: WORKFLOW_OWNER };
  const state = {};
  const selected = await sidecar.runAgentTool("ae_select_workflow_stage", { summary: "Rename", operationTypes: ["set_layer_name"] }, ownerInput, state);
  assert.equal(selected.ok, true);
  const accepted = await sidecar.runAgentTool("ae_queue_add", { summary: "Rename", operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name: "Hero" }] }, ownerInput, state);
  assert.equal(accepted.ok, true);
});

test("legacy rendered criterion labels normalize to the reducer-owned criterion id", () => {
  const sidecar = sidecarFor({ token, chatProvider: new MockProvider(), quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot("criterion-normalization"), receivedAt: "2026-09-22T12:00:00.000Z", bytes: 1 };
  const jobId = sidecar.workflowCoordinator.openJob("criterion-normalization", "Rename the selected layer");
  const continuation = sidecar.workflowCoordinator.continuation(jobId, currentSnapshot(sidecar), 0);
  const rendered = "job:goal-observed:The original user goal is satisfied by verified host evidence.";
  const input = { requestId: "criterion-normalization", message: "Complete it", history: [], autoApply: true, workflowJobId: "criterion-normalization", workflowRole: WORKFLOW_OWNER };
  const completion = sidecar.workflowCompletionTool("ae_workflow_complete", { goalDigest: continuation.goalDigest, criterionIds: [rendered], evidence: [] }, input, {});
  assert.equal(completion.ok, false);
  assert.notEqual(completion.ok ? undefined : completion.error.code, "COMPLETION_UNSUPPORTED", "the exact legacy rendering is normalized instead of rejected as undeclared");
});

test("completion with no arguments is cited by the sidecar, and a gap names what to take next", () => {
  const sidecar = sidecarFor({ token, chatProvider: new MockProvider(), quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot("own-completion"), receivedAt: "2026-09-22T12:00:00.000Z", bytes: 1 };
  sidecar.workflowCoordinator.openJob("own-completion", "Rename the selected layer");
  const input = { requestId: "own-completion", message: "Complete it", history: [], autoApply: true, workflowJobId: "own-completion", workflowRole: WORKFLOW_OWNER };
  const completion = sidecar.workflowCompletionTool("ae_workflow_complete", {}, input, {});
  assert.equal(completion.ok, false, "nothing was applied yet");
  assert.equal(completion.ok ? undefined : completion.error.code, "COMPLETION_EVIDENCE_MISSING");
  assert.match(completion.ok ? "" : completion.error.message, /then call ae_workflow_complete again with no arguments/);
});

test("the model's completion is checked for request coverage under the job's id, not the seed it was opened with", () => {
  const sidecar = sidecarFor({ token, chatProvider: new MockProvider(), quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot("coverage-seed"), receivedAt: "2026-09-22T12:00:00.000Z", bytes: 1 };
  sidecar.workflowCoordinator.openJob("coverage-seed", "Add rings to the shape layer with a repeater at 12 copies.");
  const input = { requestId: "coverage-seed", message: "Complete it", history: [], autoApply: true, workflowJobId: "coverage-seed", workflowRole: WORKFLOW_OWNER };
  const completion = sidecar.workflowCompletionTool("ae_workflow_complete", {}, input, {});
  assert.equal(completion.ok ? undefined : completion.error.code, "REQUEST_COVERAGE_INCOMPLETE");
});

test("observation-only reconciliation rejects mutation tools but keeps read-only inspection available", async () => {
  const sidecar = sidecarFor({ token, chatProvider: new MockProvider(), quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot("observation-only-boundary"), receivedAt: "2026-09-22T12:00:00.000Z", bytes: 1 };
  sidecar.workflowCoordinator?.openJob("observation-only-boundary", "Validate the rendered scene");
  const input = {
    requestId: "observation-only-boundary",
    message: "Validate it",
    history: [],
    autoApply: true,
    workflowJobId: "observation-only-boundary",
    workflowGoalSummary: "Validate it",
    workflowCycle: 1,
    workflowRole: WORKFLOW_OWNER,
    workflowObservationOnly: true,
  };

  for (const [name, args] of [
    ["ae_select_workflow_stage", { summary: "Replay", operationTypes: ["set_layer_name"] }],
    ["ae_queue_add", { summary: "Replay", operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name: "Replay" }] }],
  ] as const) {
    const denied = await sidecar.runAgentTool(name, args, input, {});
    assert.equal(denied.ok, false, `${name} must not mutate during observation reconciliation`);
    assert.equal(denied.ok ? undefined : denied.error.code, "WORKFLOW_OBSERVATION_ONLY");
  }

  const inspected = await sidecar.runAgentTool("ae_inspect_composition", { compositionId: "comp-1" }, input, {});
  assert.equal(inspected.ok, true, "read-only host evidence remains available to the validator");
});

test("workflow authoring supplies unique declaration-only ids without a provider retry", async () => {
  const sidecar = sidecarFor({ token, chatProvider: new MockProvider(), quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot("automatic-placeholder"), receivedAt: "2026-09-22T12:00:00.000Z", bytes: 1 };
  sidecar.workflowCoordinator?.openJob("automatic-placeholder", "Add two editable shape items");
  const input = { requestId: "automatic-placeholder", message: "Add shapes", history: [], autoApply: true, workflowJobId: "automatic-placeholder", workflowGoalSummary: "Add shapes", workflowCycle: 0, workflowRole: WORKFLOW_OWNER };
  const state = {};
  assert.equal((await sidecar.runAgentTool("ae_select_workflow_stage", { summary: "Add shapes", operationTypes: ["add_shape_item"] }, input, state)).ok, true);
  const args = { summary: "Two items", operations: [
    { type: "add_shape_item", target: { compositionId: "comp-1", layerId: "layer-1" }, groupId: "root", item: "rectangle", values: { size: [120, 80] } },
    { type: "add_shape_item", target: { compositionId: "comp-1", layerId: "layer-1" }, groupId: "root", item: "ellipse", values: { size: [80, 80] } },
  ] };
  const accepted = await sidecar.runAgentTool("ae_queue_add", args, input, state);
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  const ids = args.operations.map((operation) => fieldOf(operation, "newItemId"));
  assert.equal(ids.every((id) => typeof id === "string" && id.startsWith("__new__:auto-add-shape-item-")), true);
  assert.equal(new Set(ids).size, 2, "the sidecar supplies one unique declaration id per shape operation");
});

test("delegation publishes stable role metadata and the specialist stream", async () => {
  const provider = new MockProvider({ answer: brief("visual-scene", "secret visual advisory") });
  const sidecar = sidecarFor({ token, chatProvider: provider, workflowSpecialistProviders: { "visual-scene": provider }, quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot("progress-contract"), receivedAt: "2026-09-22T12:00:00.000Z", bytes: 1 };
  const input = { requestId: "progress-contract", message: "Animate a polished visual orbit", history: [], autoApply: true, workflowJobId: "progress-contract", workflowGoalSummary: "Animate a polished visual orbit", workflowRole: WORKFLOW_OWNER };
  sidecar.chatProgress.set("progress-contract", { requestId: "progress-contract", step: 2, maxSteps: 60, phase: "tool", label: "Consulting a specialist", notes: [], at: "2026-09-22T12:00:00.000Z" });
  await sidecar.runAgentTool("ae_consult_specialist", { action: "launch", role: "visual-scene", instruction: "Define the scene." }, input, {});
  await settledDesigner(sidecar, input, "wait");
  const progress = sidecar.chatProgress.get("progress-contract");
  assert.equal(progress?.phase, "delegating");
  assert.deepEqual(progress?.orchestration?.delegates, ["visual-scene"]);
  assert.deepEqual(progress?.orchestration?.registry.map((entry) => entry.role), ["visual-scene", "motion", "execution", "planner", "reviewer", "expression"]);
  assert.match(JSON.stringify(progress), /secret visual advisory/, "the launched specialist stream is visible in live progress");
});

test("a completed frame observation becomes owner-scoped visual completion evidence", async () => {
  const sidecar = sidecarFor({ token, chatProvider: new MockProvider(), quietAgentLog: true, now: () => new Date("2026-09-22T12:00:00.000Z") });
  sidecar.latest = { snapshot: mutableSnapshot("visual-observation"), receivedAt: "2026-09-22T12:00:00.000Z", bytes: 1 };
  const jobId = sidecar.workflowCoordinator.openJob("visual-observation", "Polish the visual scene");
  const command = compileCaptureCommand({ compositionId: "comp-1", time: 1, width: 320, height: 180, format: "png", shareWithProvider: false }, "capture-visual");
  if ("ok" in command) assert.fail(command.message);
  sidecar.captures.set("capture-visual", { captureId: "capture-visual", status: "completed", request: command, preview: { maxWidth: 320, maxHeight: 180 }, maxEncodedBytes: 65_536, receipt: { summary: { contentFraction: 0.25 } } });
  const input = { requestId: "visual-observation", message: "Polish the visual scene", history: [], autoApply: true, workflowJobId: "visual-observation", workflowGoalSummary: "Polish the visual scene", workflowCycle: 0, workflowRole: WORKFLOW_OWNER };
  const observed = await sidecar.runAgentTool("ae_observe_frame", { captureId: "capture-visual", waitSeconds: 0 }, input, {});
  assert.equal(observed.ok, true);
  const evidenceId = evidenceIdOf(observed, "workflowEvidence");
  const state = sidecar.workflowCoordinator.workflowStore.getState();
  assert.equal(state.observations[evidenceId]?.kind, "visual");
  assert.equal(state.observations[evidenceId]?.stageId, present(state.jobs[jobId], "job").stageIds[0]);

  const continuation = sidecar.workflowCoordinator.continuation(jobId, currentSnapshot(sidecar), 0);
  const completion = sidecar.workflowCompletionTool("ae_workflow_complete", { goalDigest: continuation.goalDigest, criterionIds: ["goal-visual"], evidence: [{ criterionId: "goal-visual", reference: { kind: "observation", evidenceId } }] }, input, {});
  assert.equal(completion.ok, false, "the observation reference is accepted, but an open stage still prevents completion");
  assert.equal(completion.ok ? undefined : completion.error.code, "COMPLETION_UNSATISFIED");
  assert.match(completion.ok ? "" : completion.error.message, /stage/i);
});

test("distinct measured frames produce typed temporal evidence, while the still remains visual evidence", async () => {
  const sidecar = sidecarFor({ token, chatProvider: new MockProvider(), quietAgentLog: true, now: () => new Date("2026-09-22T12:00:00.000Z") });
  sidecar.latest = { snapshot: mutableSnapshot("temporal-observation"), receivedAt: "2026-09-22T12:00:00.000Z", bytes: 1 };
  const jobId = sidecar.workflowCoordinator.openJob("temporal-observation", "Animate the tram across the scene");
  const input = { requestId: "temporal-observation", message: "Animate the tram across the scene", history: [], autoApply: true, workflowJobId: "temporal-observation", workflowGoalSummary: "Animate the tram across the scene", workflowCycle: 0, workflowRole: WORKFLOW_OWNER };
  const observe = async (captureId: string, time: number, summary: Readonly<Record<string, JsonValue>>) => {
    const command = compileCaptureCommand({ compositionId: "comp-1", time, width: 320, height: 180, format: "png", shareWithProvider: false }, captureId);
    if ("ok" in command) throw new Error(command.message);
    sidecar.captures.set(captureId, { captureId, status: "completed", request: command, preview: { maxWidth: 320, maxHeight: 180 }, maxEncodedBytes: 65_536, receipt: { summary } });
    return sidecar.runAgentTool("ae_observe_frame", { captureId, waitSeconds: 0 }, input, {});
  };
  const first = await observe("capture-temporal-1", 0, { contentFraction: 0.2, transparentFraction: 0, contentBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.2 } });
  const second = await observe("capture-temporal-2", 3.5, { contentFraction: 0.42, transparentFraction: 0, contentBox: { x: 0.4, y: 0.2, width: 0.3, height: 0.2 } });
  assert.equal(maybeTextOf(second.ok ? second.data : undefined, "workflowEvidence.evidenceKind"), "visual");
  assert.equal(maybeTextOf(second.ok ? second.data : undefined, "temporalEvidence.evidenceKind"), "temporal");
  const state = sidecar.workflowCoordinator.workflowStore.getState();
  assert.equal(state.observations[evidenceIdOf(first, "workflowEvidence")]?.kind, "visual");
  assert.equal(state.observations[evidenceIdOf(second, "temporalEvidence")]?.kind, "temporal");
  assert.equal(state.jobs[jobId]?.successCriteria.some((criterion) => criterion.requiredEvidenceKind === "temporal"), true);
});

test("the animator starts from the designer's finished scene, not alongside it", async () => {
  let releaseDesign!: () => void;
  const designing = new Promise<void>((resolve) => { releaseDesign = resolve; });
  const designer = new MockProvider({ script: async (step) => { await designing; return designerTurn(step, DESIGN_SVG, "Planet low-left; each ring split into a back arc below the planet and a front arc above it."); } });
  const animator = new MockProvider({ answer: brief("motion", "One clockwise orbit around the planet.") });
  const sidecar = sidecarFor({ token, chatProvider: designer, workflowSpecialistProviders: { "visual-scene": designer, motion: animator }, quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot("design-then-motion"), receivedAt: "2026-09-24T14:46:59.000Z", bytes: 1 };
  const input = { requestId: "design-then-motion", message: "Rocket orbiting a ringed planet", history: [], autoApply: false, workflowJobId: "design-then-motion", workflowGoalSummary: "Rocket orbiting a ringed planet", workflowRole: WORKFLOW_OWNER };
  assert.equal((await sidecar.runAgentTool("ae_consult_specialist", { action: "launch", role: "visual-scene", instruction: "Design the scene." }, input, {})).ok, true);
  const launched = await sidecar.runAgentTool("ae_consult_specialist", { action: "launch", role: "motion", instruction: "Design the motion." }, input, {});
  assert.equal(statusOf(launched), "running", "the chained motion turn reads as running while it waits");
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(animator.calls, 0, "the animator does not start while the scene is still being designed");
  releaseDesign();
  const waited = await sidecar.runAgentTool("ae_consult_specialist", { action: "wait", role: "motion", waitSeconds: 1 }, input, {});
  assert.equal(statusOf(waited), "sleeping");
  assert.equal(animator.calls, 1);
  assert.match(JSON.stringify(animator.stepInputs[0]?.messages), /each ring split into a back arc below the planet/, "the animator's instruction carries the designer's report");
  assert.match(JSON.stringify(animator.stepInputs[0]?.messages), /bottom-to-top.*Ring Back.*Planet.*Ring Front/, "and the compiled layers it will animate, by name and position");
});

test("a motion launch after the design is ready carries it at once", async () => {
  const designer = new MockProvider({ answer: brief("visual-scene", "Sky, planet, ring back, ring front, rocket.") });
  const animator = new MockProvider({ answer: brief("motion", "Launch, orbit, exit.") });
  const sidecar = sidecarFor({ token, chatProvider: designer, workflowSpecialistProviders: { "visual-scene": designer, motion: animator }, quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot("design-ready"), receivedAt: "2026-09-24T14:46:59.000Z", bytes: 1 };
  const input = { requestId: "design-ready", message: "Rocket orbiting a ringed planet", history: [], autoApply: true, workflowJobId: "design-ready", workflowGoalSummary: "Rocket orbiting a ringed planet", workflowRole: WORKFLOW_OWNER };
  await sidecar.runAgentTool("ae_consult_specialist", { action: "launch", role: "visual-scene", instruction: "Design the scene." }, input, {});
  await settledDesigner(sidecar, input, "wait");
  await sidecar.runAgentTool("ae_consult_specialist", { action: "launch", role: "motion", instruction: "Design the motion." }, input, {});
  await sidecar.runAgentTool("ae_consult_specialist", { action: "wait", role: "motion", waitSeconds: 1 }, input, {});
  assert.match(JSON.stringify(animator.stepInputs[0]?.messages), /Sky, planet, ring back, ring front, rocket/);
});

test("time the owner spends waiting on a specialist is given back to its turn", async () => {
  const specialist = new MockProvider({ script: async () => { await new Promise((resolve) => setTimeout(resolve, 30)); return { text: brief("motion", "A move."), toolCalls: [] }; } });
  const sidecar = sidecarFor({ token, chatProvider: specialist, workflowSpecialistProviders: { motion: specialist }, quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot("landing-extension"), receivedAt: "2026-09-24T14:46:59.000Z", bytes: 1 };
  const extensions: number[] = [];
  const input = { requestId: "landing-extension", message: "Build a scene", history: [], autoApply: true, workflowJobId: "landing-extension", workflowGoalSummary: "Build a scene", workflowRole: WORKFLOW_OWNER, extendLanding: (milliseconds: number) => { extensions.push(milliseconds); } };
  await sidecar.runAgentTool("ae_consult_specialist", { action: "launch", role: "motion", instruction: "Design the motion." }, input, {});
  await sidecar.runAgentTool("ae_consult_specialist", { action: "wait", role: "motion", waitSeconds: 5 }, input, {});
  assert.equal(extensions.length, 1);
  assert.ok((extensions[0] ?? 0) >= 20, "the wait's own duration comes back to the owner");
});

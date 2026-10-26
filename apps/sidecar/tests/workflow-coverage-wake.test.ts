/** A prose answer with named features still missing wakes the same loop, instead of ending the cycle for a continuation that re-reads the project. */
import assert from "node:assert/strict";
import test from "node:test";
import { MockProvider, type AgentStepInput } from "@extynt/llm";
import { readJson } from "./http-json.js";
import { chatTurn } from "./sidecar-fixture.js";
import { coverageWake } from "../src/server-workflow-coverage-wake.js";
import { WORKFLOW_OWNER } from "../src/workflow-orchestration.js";
import { post, rigFor, step, toolCalls, type Rig, type Script } from "./single-loop-rig.js";

const TIMING = { type: "set_layer_timing", target: { compositionId: "comp-1", layerId: "layer-1" }, inPoint: 0, outPoint: 2 };
const NULL_LAYER = { type: "create_layer", target: { compositionId: "comp-1", layerId: "__new__:ctrl" }, layerType: "null", name: "Control" };
const GOAL = "trim the title to two seconds and add a null layer";
const COVERAGE_WAKE = "Sidecar wake event: The request names features the project does not show yet";

const userMessages = (input: AgentStepInput): string[] => input.messages.filter((message) => message.role === "user").map((message) => message.content);
const coverageWakes = (input: AgentStepInput): string[] => userMessages(input).filter((content) => content.includes(COVERAGE_WAKE));
const count = (input: AgentStepInput, name: string): number => toolCalls(input).filter((called) => called === name).length;
const jobStatuses = (rig: Rig): string[] => Object.values(rig.sidecar.workflowCoordinator.workflowStore.getState().jobs).map((job) => job.status);

test("prose with a missing feature wakes the loop once, and the whole job completes in that one provider cycle", async (t) => {
  let message = "";
  const script: Script = (input) => {
    const adds = count(input, "ae_queue_add"), finishes = count(input, "ae_queue_finish"), woken = coverageWakes(input);
    if (woken[0]) message = woken[0];
    if (adds === 0) return step("w-add", "ae_queue_add", { summary: "Trim the title", operations: [TIMING] });
    if (finishes === 0) return step("w-finish", "ae_queue_finish", {});
    if (!woken.length) return { text: "Trimmed the title.", toolCalls: [] };
    if (adds === 1) return step("w-add-null", "ae_queue_add", { summary: "Add the null", operations: [NULL_LAYER] });
    if (finishes === 1) return step("w-finish-null", "ae_queue_finish", {});
    return { text: "Trimmed the title and added the null.", toolCalls: [] };
  };
  const rig = await rigFor(t, script, "wake-missing", [["set_layer_timing"], ["create_layer"]]);
  const reply = await chatTurn(rig.address, GOAL, [], { autoApply: true });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  assert.equal(reply.answer, "Trimmed the title and added the null.");
  assert.equal(rig.provider.calls, 6, "add, seal, prose, woken add, woken seal, prose: no continuation cycle");
  assert.equal(rig.applied.length, 2, "both batches reached the host");
  assert.deepEqual(jobStatuses(rig), ["completed"]);
  assert.match(message, /null layer/, "the wake names what is missing");
  assert.match(message, /do not re-inspect or re-describe/);
});

test("no wake when the request's features are all present", async (t) => {
  let wakes = 0;
  const rig = await rigFor(t, (input) => {
    wakes += coverageWakes(input).length;
    const called = toolCalls(input);
    if (!called.includes("ae_queue_add")) return step("c-add", "ae_queue_add", { summary: "Trim and add the null", operations: [TIMING, NULL_LAYER] });
    if (!called.includes("ae_queue_finish")) return step("c-finish", "ae_queue_finish", {});
    return { text: "Done.", toolCalls: [] };
  }, "wake-complete", [["set_layer_timing", "create_layer"]]);
  const reply = await chatTurn(rig.address, GOAL, [], { autoApply: true });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  assert.equal(rig.provider.calls, 3);
  assert.equal(wakes, 0);
  assert.deepEqual(jobStatuses(rig), ["completed"]);
});

test("a model that keeps answering without adding the feature is woken only up to the no-progress limit, then the turn ends", async (t) => {
  let most = 0;
  const rig = await rigFor(t, (input) => {
    most = Math.max(most, coverageWakes(input).length);
    const called = toolCalls(input);
    if (!called.includes("ae_queue_add")) return step("b-add", "ae_queue_add", { summary: "Trim the title", operations: [TIMING] });
    if (!called.includes("ae_queue_finish")) return step("b-finish", "ae_queue_finish", {});
    return { text: "Done.", toolCalls: [] };
  }, "wake-bounded", [["set_layer_timing"]]);
  const reply = await chatTurn(rig.address, GOAL, [], { autoApply: true });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  assert.equal(most, 2, "woken twice at most (the ledger's limit), never trapped");
  assert.equal(rig.provider.calls, 5, "add, seal and three prose answers");
});

test("discovery, read-only, cancelled, non-owner and near-limit turns are never woken, a plain owner turn is", async (t) => {
  const verdicts: Record<string, string | undefined> = {};
  const room = { stepsLeft: 40, wrapUp: 6 };
  const requestId = "wake-guards";
  const rigRef: { rig?: Rig } = {};
  const probe = (): void => {
    const live = rigRef.rig;
    if (!live || "owner" in verdicts) return;
    const deps = { state: { workflowCoordinator: live.sidecar.workflowCoordinator, plans: live.sidecar.plans }, planState: { normalizedLatest: () => live.sidecar.normalizedLatest() } };
    const owner = { requestId, message: GOAL, history: [], autoApply: true, workflowJobId: requestId, workflowRole: WORKFLOW_OWNER };
    const abort = new AbortController(); abort.abort();
    verdicts.discovery = coverageWake(deps, { ...owner, discoveryOnly: true }, room);
    verdicts.observation = coverageWake(deps, { ...owner, workflowObservationOnly: true }, room);
    verdicts.cancelled = coverageWake(deps, { ...owner, signal: abort.signal }, room);
    verdicts.specialist = coverageWake(deps, { requestId, message: GOAL, history: [], autoApply: true, workflowJobId: requestId }, room);
    verdicts.nearLimit = coverageWake(deps, owner, { stepsLeft: 8, wrapUp: 6 });
    verdicts.owner = coverageWake(deps, owner, room);
  };
  const rig = await rigFor(t, (input) => {
    const called = toolCalls(input);
    if (!called.includes("ae_queue_add")) return step("g-add", "ae_queue_add", { summary: "Trim the title", operations: [TIMING] });
    if (!called.includes("ae_queue_finish")) return step("g-finish", "ae_queue_finish", {});
    probe();
    return { text: "Done.", toolCalls: [] };
  }, "wake-guards", [["set_layer_timing"]]);
  rigRef.rig = rig;
  await readJson(await post(rig.base, "/v1/chat", { requestId, message: GOAL, history: [], autoApply: true }));
  for (const key of ["discovery", "observation", "cancelled", "specialist", "nearLimit"]) assert.equal(verdicts[key], undefined, key);
  assert.match(verdicts.owner ?? "", /null layer/);
});

test("the specialist wake still comes first, and the coverage wake follows once the handoff is read", async (t) => {
  const specialist = new MockProvider({ script: async () => ({ text: JSON.stringify({ role: "motion", objective: "o", requirements: ["r"], deliverables: ["d"], constraints: ["c"], verification: ["v"] }), toolCalls: [] }) });
  const order: string[] = [];
  const noteWakes = (input: AgentStepInput): { specialistWoken: boolean; coverageWoken: boolean } => {
    const specialistWoken = userMessages(input).some((content) => content.includes("Sidecar wake event: motion turn")), coverageWoken = coverageWakes(input).length > 0;
    if (specialistWoken && !order.includes("specialist")) order.push("specialist");
    if (coverageWoken && !order.includes("coverage")) order.push("coverage");
    return { specialistWoken, coverageWoken };
  };
  const build: Script = (input) => {
    const adds = count(input, "ae_queue_add"), finishes = count(input, "ae_queue_finish");
    if (count(input, "ae_consult_specialist") === 0) return step("e-launch", "ae_consult_specialist", { action: "launch", role: "motion", instruction: "Plan the timing of the title." });
    if (adds === 0) return step("e-add", "ae_queue_add", { summary: "Trim the title", operations: [TIMING] });
    return finishes === 0 ? step("e-finish", "ae_queue_finish", {}) : { text: "Trimmed.", toolCalls: [] };
  };
  const woken: Script = (input) => {
    const adds = count(input, "ae_queue_add"), finishes = count(input, "ae_queue_finish");
    if (adds === 1) return step("e-null", "ae_queue_add", { summary: "Add the null", operations: [NULL_LAYER] });
    return finishes === 1 ? step("e-finish-null", "ae_queue_finish", {}) : { text: "Done.", toolCalls: [] };
  };
  const rig = await rigFor(t, (input) => {
    const { specialistWoken, coverageWoken } = noteWakes(input);
    if (coverageWoken) return woken(input);
    if (!specialistWoken) return build(input);
    return count(input, "ae_consult_specialist") === 1 ? step("e-status", "ae_consult_specialist", { action: "status", role: "motion" }) : { text: "Read it.", toolCalls: [] };
  }, "wake-specialist", [["set_layer_timing"], ["create_layer"]], specialist);
  const reply = await chatTurn(rig.address, GOAL, [], { autoApply: true });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  assert.deepEqual(order, ["specialist", "coverage"]);
  assert.deepEqual(jobStatuses(rig), ["completed"]);
});

test("a finished job is not woken for a specialist handoff it built without: the prose answer completes it", async (t) => {
  const specialist = new MockProvider({ script: async () => ({ text: JSON.stringify({ role: "motion", objective: "o", requirements: ["r"], deliverables: ["d"], constraints: ["c"], verification: ["v"] }), toolCalls: [] }) });
  let specialistWakes = 0;
  const rig = await rigFor(t, (input) => {
    if (userMessages(input).some((content) => content.includes("Sidecar wake event: motion turn"))) specialistWakes += 1;
    const called = toolCalls(input);
    if (!called.includes("ae_consult_specialist")) return step("s-launch", "ae_consult_specialist", { action: "launch", role: "motion", instruction: "Plan the timing of the title." });
    if (!called.includes("ae_queue_add")) return step("s-add", "ae_queue_add", { summary: "Trim and add the null", operations: [TIMING, NULL_LAYER] });
    if (!called.includes("ae_queue_finish")) return step("s-finish", "ae_queue_finish", {});
    return { text: "Done.", toolCalls: [] };
  }, "wake-finished-specialist", [["set_layer_timing", "create_layer"]], specialist);
  const reply = await chatTurn(rig.address, GOAL, [], { autoApply: true });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  assert.equal(specialistWakes, 0, "no step is spent reading a handoff the finished job does not need");
  assert.equal(rig.provider.calls, 4, "launch, add, seal, prose");
  assert.deepEqual(jobStatuses(rig), ["completed"]);
});

test("a batch only a frame can prove, with every named feature present, completes in the turn that built it", async (t) => {
  const rig = await rigFor(t, (input) => {
    const called = toolCalls(input);
    if (!called.includes("ae_queue_add")) return step("f-add", "ae_queue_add", { summary: "Add the null", operations: [NULL_LAYER] });
    if (!called.includes("ae_queue_finish")) return step("f-finish", "ae_queue_finish", {});
    return { text: "Added the null.", toolCalls: [] };
  }, "wake-reopened", [["create_layer?"]]);
  const reply = await chatTurn(rig.address, "add a null layer", [], { autoApply: true });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  const state = rig.sidecar.workflowCoordinator.workflowStore.getState();
  assert.ok(Object.values(state.batches).some((batch) => batch.verification.state === "applied_unverified"), "the batch stayed applied_unverified");
  assert.deepEqual(jobStatuses(rig), ["completed"], "the sidecar took the frames and closed the job without a second cycle");
  assert.equal(rig.provider.calls, 3);
});

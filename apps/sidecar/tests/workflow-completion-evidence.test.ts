/** Completion costs one step: a capture-and-observe pair counts the first time, ae_workflow_complete gathers what is missing itself, and a finished first cycle closes without a second one. */
import type { JsonObject } from "@extynt/decode";
import assert from "node:assert/strict";
import test from "node:test";
import type { AgentStepInput, AgentStepResult } from "@extynt/llm";
import { chatTurn } from "./sidecar-fixture.js";
import { rigFor, step, toolCalls, RINGS_FRAME, type Rig, type Script } from "./single-loop-rig.js";

const GOAL = "Animate the title so it slides in from the left with out-expo easing, then holds, and keep its look clean.";
const POSITION = "ADBE Transform Group/ADBE Position";
const SLIDE = [{ type: "animate_property", target: { compositionId: "comp-1", layerId: "layer-1", propertyPath: POSITION }, role: "transform.position", keyframes: [{ time: 0.8, value: [-200, 540] }, { time: 2.4, value: [960, 540] }] }];
const HOLD = [{ type: "set_layer_timing", target: { compositionId: "comp-1", layerId: "layer-1" }, inPoint: 0, outPoint: 8 }];
const SHAPE = { type: "create_layer", target: { compositionId: "comp-1", layerId: "__new__:rings" }, layerType: "shape", name: "Rings" };
type Frame = typeof RINGS_FRAME;
const BATCHES = [["animate_property"], ["set_layer_timing?"]];

function slideFrame(time: number): Frame {
  const x = time <= 0.8 ? 0 : time >= 2.4 ? 0.4 : 0.4 * (time - 0.8) / 1.6;
  return { ...RINGS_FRAME, contentBox: { x, y: 0.4, width: 0.2, height: 0.1 }, regionContent: x < 0.2 ? [0, 0, 0, 0.3, 0, 0, 0, 0, 0] : [0, 0, 0, 0, 0.3, 0, 0, 0, 0] };
}

function rampFrame(time: number): Frame {
  const title = time <= 0.8 ? 0 : time >= 2.4 ? 0.3 : 0.3 * (time - 0.8) / 1.6;
  return { ...RINGS_FRAME, contentFraction: 1, contentBox: { x: 0, y: 0, width: 1, height: 1 }, regionContent: [1, 1, 1, 1, 1, 1, 1, 1, 1], dominantColors: [{ hex: "#1e293b", fraction: 1 - title }, ...(title ? [{ hex: "#f8fafc", fraction: title }] : [])] };
}

const REVEAL = [{ type: "animate_property", target: { compositionId: "comp-1", layerId: "layer-1", propertyPath: POSITION }, role: "transform.position", keyframes: [0, 0.4, 0.8, 1.2, 1.8, 2, 2.4, 3, 3.6, 4.8, 6, 7.2, 8.4, 9.8, 10].map((time) => ({ time, value: [time * 10, 540] })) }];
function revealFrame(time: number): Frame {
  const sweep = time >= 2 && time <= 3.6 ? 0.3 : 0;
  return { ...RINGS_FRAME, contentFraction: 1, contentBox: { x: 0, y: 0, width: 1, height: 1 }, regionContent: [1, 1, 1, 1, 1, 1, 1, 1, 1], dominantColors: [{ hex: "#1e293b", fraction: 1 - sweep }, ...(sweep ? [{ hex: "#f8fafc", fraction: sweep }] : [])] };
}

const toolMessages = (input: AgentStepInput) => input.messages.filter((message) => message.role === "tool");
const captureIds = (input: AgentStepInput) => toolMessages(input).filter((message) => message.name === "ae_capture_composition_frame").map((message) => /frame-[0-9a-f]+/.exec(message.content)?.[0] ?? "");
const both = (id: string, name: string, first: JsonObject, second: JsonObject): AgentStepResult => ({ text: "", toolCalls: [{ id: `${id}-1`, name, arguments: first }, { id: `${id}-2`, name, arguments: second }] });
const completeCalls = (reply: Awaited<ReturnType<typeof chatTurn>>) => reply.tools.filter((tool) => tool.name === "ae_workflow_complete");

function jobStatus(rig: Rig): string[] {
  return Object.values(rig.sidecar.workflowCoordinator.workflowStore.getState().jobs).map((job) => job.status);
}

function temporalObservations(rig: Rig): number {
  return Object.values(rig.sidecar.workflowCoordinator.workflowStore.getState().observations).filter((row) => row.kind === "temporal").length;
}

function buildBoth(input: AgentStepInput): AgentStepResult | undefined {
  const called = toolCalls(input);
  const adds = called.filter((name) => name === "ae_queue_add").length, finishes = called.filter((name) => name === "ae_queue_finish").length;
  if (adds === 0) return step("r-add", "ae_queue_add", { summary: "Slide the title in", operations: SLIDE });
  if (finishes === 0) return step("r-finish", "ae_queue_finish", {});
  if (adds === 1) return step("r-add2", "ae_queue_add", { summary: "Hold the title", operations: HOLD });
  if (finishes === 1) return step("r-finish2", "ae_queue_finish", {});
  return undefined;
}

function finishedOnce(script: (input: AgentStepInput) => AgentStepResult): { script: Script; afterDone: () => number } {
  let done = false, extra = 0;
  return { afterDone: () => extra, script: (input) => { if (done) { extra += 1; return { text: "Done.", toolCalls: [] }; } const next = script(input); done = !next.toolCalls.length; return next; } };
}

test("a double refusal is avoided: two frames over a full-frame backdrop, after an unread batch, count as temporal evidence on the first completion", async (t) => {
  const { script, afterDone } = finishedOnce((input) => {
    const built = buildBoth(input);
    if (built) return built;
    const called = toolCalls(input);
    if (!called.includes("ae_capture_composition_frame")) return both("r-capture", "ae_capture_composition_frame", { compositionId: "comp-1", time: 0.5, waitSeconds: 5 }, { compositionId: "comp-1", time: 3, waitSeconds: 5 });
    if (!called.includes("ae_observe_frame")) { const [first, second] = captureIds(input); return both("r-observe", "ae_observe_frame", { captureId: first ?? "", waitSeconds: 5 }, { captureId: second ?? "", waitSeconds: 5 }); }
    if (!called.includes("ae_workflow_complete")) return step("r-complete", "ae_workflow_complete", {});
    return { text: "Done.", toolCalls: [] };
  });
  const rig = await rigFor(t, script, "completion-double-refusal", BATCHES);
  Object.assign(rig, { frames: rampFrame, distinctSnapshots: true });
  const reply = await chatTurn(rig.address, GOAL, [], { autoApply: true });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  assert.deepEqual(completeCalls(reply).map((tool) => tool.ok), [true], `one accepted completion: ${JSON.stringify(reply.tools)}`);
  assert.ok(temporalObservations(rig) >= 1, "the 0.5 s / 3 s pair was recorded as motion");
  assert.deepEqual(jobStatus(rig), ["completed"]);
  assert.equal(afterDone(), 0, "no second provider cycle");
});

test("one ae_workflow_complete call completes a finished job: the sidecar captures and observes the keyframe times the job lacks, then retries", async (t) => {
  const captured: number[] = [];
  const { script } = finishedOnce((input) => {
    const built = buildBoth(input);
    if (built) return built;
    if (!toolCalls(input).includes("ae_workflow_complete")) return step("r-complete", "ae_workflow_complete", {});
    return { text: "Done.", toolCalls: [] };
  });
  const rig = await rigFor(t, script, "completion-one-call", BATCHES);
  Object.assign(rig, { frames: slideFrame, distinctSnapshots: true, captured });
  const reply = await chatTurn(rig.address, GOAL, [], { autoApply: true });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  assert.deepEqual(completeCalls(reply).map((tool) => tool.ok), [true], `the first call completed: ${JSON.stringify(reply.tools)}`);
  assert.ok(captured.includes(0.8) && captured.includes(2.4), `frames at the slide's own keyframes: ${captured.join(", ")}`);
  assert.ok(temporalObservations(rig) >= 1);
  assert.deepEqual(jobStatus(rig), ["completed"]);
});

test("a first cycle that builds everything and ends in prose completes with no second provider cycle", async (t) => {
  const { script, afterDone } = finishedOnce((input) => buildBoth(input) ?? { text: "The title slides in and holds.", toolCalls: [] });
  const rig = await rigFor(t, script, "completion-finished-turn", BATCHES);
  Object.assign(rig, { frames: slideFrame, distinctSnapshots: true });
  const reply = await chatTurn(rig.address, GOAL, [], { autoApply: true });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  assert.deepEqual(jobStatus(rig), ["completed"]);
  assert.equal(afterDone(), 0, "the provider was not asked again after the prose");
  assert.equal(completeCalls(reply).length, 0, "the model never called ae_workflow_complete");
});

test("motion the frames cannot show is never completed, and the refusal names the frames it saw and why the receipt cannot stand in", async (t) => {
  let refusal = "";
  const { script } = finishedOnce((input) => {
    const built = buildBoth(input);
    if (built) return built;
    const answered = toolMessages(input).filter((message) => message.name === "ae_workflow_complete");
    if (!answered.length) return step("r-complete", "ae_workflow_complete", {});
    refusal = answered[0]?.content ?? "";
    return { text: "Done.", toolCalls: [] };
  });
  const rig = await rigFor(t, script, "completion-unproven-turn", BATCHES);
  Object.assign(rig, { frames: () => RINGS_FRAME, distinctSnapshots: true });
  await chatTurn(rig.address, GOAL, [], { autoApply: true });
  assert.notDeepEqual(jobStatus(rig), ["completed"], "frames that never change cannot prove the motion");
  assert.equal(temporalObservations(rig), 0);
  assert.match(refusal, /goal-temporal needs a temporal observation, and the frames observed at the current project measured the same picture at every time/);
  assert.match(refusal, /Frames observed at the current project: [^.]*comp-1 at 0\.8 s, comp-1 at 2\.4 s/);
  assert.match(refusal, /newest verified receipt \(batch [^)]+\) was read before the project last changed/);
  assert.doesNotMatch(refusal, /none has been observed yet/);
});

function buildSlideOnly(input: AgentStepInput): AgentStepResult | undefined {
  const called = toolCalls(input);
  const adds = called.filter((name) => name === "ae_queue_add").length, finishes = called.filter((name) => name === "ae_queue_finish").length;
  if (adds === 0) return step("s-add", "ae_queue_add", { summary: "Slide the title in", operations: SLIDE });
  if (finishes === 0) return step("s-finish", "ae_queue_finish", {});
  return undefined;
}

test("S4 shape: verified keyframe work and a single-time frame, completed with {}: the sidecar takes the motion frames inside the call instead of refusing with INVALID_EVENT", async (t) => {
  const captured: number[] = [];
  const { script, afterDone } = finishedOnce((input) => buildSlideOnly(input) ?? (!toolCalls(input).includes("ae_workflow_complete") ? step("s-complete", "ae_workflow_complete", {}) : { text: "Done.", toolCalls: [] }));
  const rig = await rigFor(t, script, "completion-s4-shape", [["animate_property"]]);
  rig.sidecar.workflowCoordinator.bindDesignContext(() => ({ designed: false, motion: true }));
  Object.assign(rig, { frames: slideFrame, distinctSnapshots: true, captured });
  const reply = await chatTurn(rig.address, GOAL, [], { autoApply: true });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  assert.deepEqual(completeCalls(reply).map((tool) => tool.ok), [true], `one accepted completion: ${JSON.stringify(reply.tools)}`);
  assert.ok(temporalObservations(rig) >= 1, "the motion was measured before completion");
  assert.ok(captured.includes(0.8) && captured.includes(2.4), `frames at the keyframes: ${captured.join(", ")}`);
  assert.deepEqual(jobStatus(rig), ["completed"]);
  assert.equal(afterDone(), 0, "no continuation cycle");
});

test("a job of static writes only and a motion goal: completion is refused with one sentence naming the criterion and the frames it lacks, never INVALID_EVENT", async (t) => {
  let refusal = "";
  const { script } = finishedOnce((input) => {
    const called = toolCalls(input);
    if (!called.includes("ae_queue_add")) return step("h-add", "ae_queue_add", { summary: "Hold the title", operations: [SHAPE] });
    if (!called.includes("ae_queue_finish")) return step("h-finish", "ae_queue_finish", {});
    const answered = toolMessages(input).filter((message) => message.name === "ae_workflow_complete");
    if (!answered.length) return step("h-complete", "ae_workflow_complete", {});
    refusal = answered[0]?.content ?? "";
    return { text: "Done.", toolCalls: [] };
  });
  const rig = await rigFor(t, script, "completion-static-only", [["create_layer"]]);
  Object.assign(rig, { frames: () => RINGS_FRAME, distinctSnapshots: true });
  await chatTurn(rig.address, GOAL, [], { autoApply: true });
  assert.notDeepEqual(jobStatus(rig), ["completed"], "static writes never prove motion");
  assert.equal(temporalObservations(rig), 0);
  assert.match(refusal, /Criterion goal-temporal needs a temporal observation/);
  assert.doesNotMatch(refusal, /INVALID_EVENT|does not carry it/);
});

test("run 14's reveal: ends that look alike do not stop the auto path, which also never captures one time twice", async (t) => {
  const captured: number[] = [];
  const { script } = finishedOnce((input) => {
    if (!toolCalls(input).includes("ae_queue_add")) return step("v-add", "ae_queue_add", { summary: "Reveal the title", operations: REVEAL });
    if (!toolCalls(input).includes("ae_queue_finish")) return step("v-finish", "ae_queue_finish", {});
    return !toolCalls(input).includes("ae_workflow_complete") ? step("v-complete", "ae_workflow_complete", {}) : { text: "Done.", toolCalls: [] };
  });
  const rig = await rigFor(t, script, "completion-reveal", [["animate_property"]]);
  rig.sidecar.workflowCoordinator.bindDesignContext(() => ({ designed: false, motion: true }));
  Object.assign(rig, { frames: revealFrame, distinctSnapshots: true, captured });
  const reply = await chatTurn(rig.address, GOAL, [], { autoApply: true });
  assert.deepEqual(completeCalls(reply).map((tool) => tool.ok), [true], `one accepted completion: ${JSON.stringify(reply.tools)}`);
  assert.equal(new Set(captured).size, captured.length, `no time captured twice: ${captured.join(", ")}`);
  assert.ok(captured.some((time) => time > 1.9 && time < 3.7), `a frame while it moves: ${captured.join(", ")}`);
  assert.ok(temporalObservations(rig) >= 1);
  assert.deepEqual(jobStatus(rig), ["completed"]);
});

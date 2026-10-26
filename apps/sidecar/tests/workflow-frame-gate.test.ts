// A layer the job placed outside its frame holds completion (LAYER_OFF_FRAME) and wakes the loop with the fix; motion through the edge and a corrected layer do not.
import assert from "node:assert/strict";
import test from "node:test";
import type { AgentStepInput } from "@extynt/llm";
import { chatTurn } from "./sidecar-fixture.js";
import { LAYER_OFF_FRAME } from "../src/server-workflow-frame-gate.js";
import type { FrameCheckRow } from "../src/verify/frame-check.js";
import { rigFor, step, toolCalls, type Rig, type Script } from "./single-loop-rig.js";

const TIMING = { type: "set_layer_timing", target: { compositionId: "comp-1", layerId: "layer-1" }, inPoint: 0, outPoint: 2 };
const GOAL = "trim the title to two seconds";
const WAKE = "Sidecar wake event: Title is mostly outside the 1920×1080 frame";
const MESSAGE = "Title is mostly outside the 1920×1080 frame at 5 s (25% of its box is inside): its box spans x 1636–2203, y 1028–1131. It is parented to Title Null (world 960,540), so its Position, and any Position expression, is relative to that layer rather than the composition: to centre it, use Position ≈ (-293,50).";
const OFF: FrameCheckRow = { compositionId: "comp-1", layerId: "layer-1", layer: "Title", verdict: "CLIPPED", time: 5, box: { left: 1636, top: 1028, right: 2203, bottom: 1131 }, parent: { name: "Title Null", world: [960, 540] }, suggestedPosition: [-293, 50], message: MESSAGE };
const FIXED: FrameCheckRow = { compositionId: "comp-1", layerId: "layer-1", layer: "Title", verdict: "IN_FRAME" };

const count = (input: AgentStepInput, name: string): number => toolCalls(input).filter((called) => called === name).length;
const wakes = (input: AgentStepInput): string[] => input.messages.filter((message) => message.role === "user" && message.content.includes(WAKE)).map((message) => message.content);
const jobStatuses = (rig: Rig): string[] => Object.values(rig.sidecar.workflowCoordinator.workflowStore.getState().jobs).map((job) => job.status);

const placing = (rounds: number): Script => (input) => {
  const adds = count(input, "ae_queue_add"), finishes = count(input, "ae_queue_finish");
  if (adds > finishes) return step(`s-finish-${adds}`, "ae_queue_finish", {});
  if (adds < rounds && (adds === 0 || wakes(input).length >= adds)) return step(`s-add-${adds}`, "ae_queue_add", { summary: `Place the title ${adds}`, operations: [TIMING] });
  return { text: "Placed.", toolCalls: [] };
};

test("an off-frame verdict wakes the loop with the fix, and the corrected batch lets the job complete", async (t) => {
  let message = "";
  const rig = await rigFor(t, (input) => {
    message = wakes(input)[0] ?? message;
    return placing(2)(input);
  }, "frame-fixed", [["set_layer_timing"], ["set_layer_timing"]]);
  rig.frameChecks = (batch) => [batch === 0 ? OFF : FIXED];
  const reply = await chatTurn(rig.address, GOAL, [], { autoApply: true });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  assert.match(message, /to centre it, use Position ≈ \(-293,50\)/);
  assert.equal(rig.applied.length, 2);
  assert.deepEqual(jobStatuses(rig), ["completed"]);
});

test("a standing verdict refuses ae_workflow_complete with LAYER_OFF_FRAME and the job stays open", async (t) => {
  const rig = await rigFor(t, (input) => {
    const adds = count(input, "ae_queue_add");
    if (adds === 0) return step("d-add", "ae_queue_add", { summary: "Place the title", operations: [TIMING] });
    if (count(input, "ae_queue_finish") === 0) return step("d-finish", "ae_queue_finish", {});
    if (count(input, "ae_workflow_complete") === 0) return step("d-complete", "ae_workflow_complete", { summary: "Placed the title." });
    return { text: "Stopped.", toolCalls: [] };
  }, "frame-refused", [["set_layer_timing"]]);
  rig.frameChecks = () => [OFF];
  const reply = await chatTurn(rig.address, GOAL, [], { autoApply: true });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  assert.match(JSON.stringify(reply), new RegExp(LAYER_OFF_FRAME));
  assert.notDeepEqual(jobStatuses(rig), ["completed"]);
});

test("a layer that is in the frame at any drawn sample is never held", async (t) => {
  const rig = await rigFor(t, placing(1), "frame-transient", [["set_layer_timing"]]);
  rig.frameChecks = () => [FIXED];
  const reply = await chatTurn(rig.address, GOAL, [], { autoApply: true });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  assert.deepEqual(jobStatuses(rig), ["completed"]);
  assert.equal(rig.provider.calls, 3);
});

test("the placement wake is made at most twice per job", async (t) => {
  let most = 0;
  const rig = await rigFor(t, (input) => {
    most = Math.max(most, wakes(input).length);
    return placing(1)(input);
  }, "frame-capped", [["set_layer_timing"]]);
  rig.frameChecks = () => [OFF];
  await chatTurn(rig.address, GOAL, [], { autoApply: true });
  assert.equal(most, 2, "woken twice, never trapped");
});

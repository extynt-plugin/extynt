/** Animation habits are wired into the real flows: a verified receipt records the keyframe span and easing of what it animated, an unverified one and an undo do not, and the briefing says so once there are enough samples. */
import { textOf, type JsonObject } from "./http-json.js";
import { claimWork } from "./host-apply.js";
import { hostCensus, mutableSnapshot, queueHarness, type QueueHarness } from "./sidecar-fixture.js";
import { usageBriefingLine } from "../src/effect-notes-briefing.js";
import assert from "node:assert/strict";
import test from "node:test";

const OPACITY = "ADBE Transform Group/ADBE Opacity";
const TARGET = { compositionId: "comp-1", layerId: "layer-1", propertyPath: OPACITY };
const fade = (end: number) => ({ type: "animate_property", target: TARGET, role: "transform.opacity", keyframes: [{ time: 0, value: 0, curve: "easy-ease" }, { time: end, value: 100 }] });
const step = (verificationState: string) => ({ operation: "animate_property", verificationState, compositionId: "comp-1", layerId: "layer-1", propertyPath: OPACITY, basis: "fixture readback" });
const executed = (steps: JsonObject[], postcondition = "passed") => ({ status: "executed", postcondition, verification: { state: "exact", basis: "fixture readback", steps } });

async function applied(harness: QueueHarness, input: { operations: JsonObject[]; receipt: JsonObject }): Promise<string> {
  const proposed = await harness.agent("ae_propose_plan", { summary: "Fade", operations: input.operations });
  assert.equal(proposed.body.ok, true, JSON.stringify(proposed.body.error));
  const planId = textOf(proposed.body.data, "planId"), approving = harness.agent("ae_approve_plan", { planId, waitSeconds: 5 });
  await claimWork(harness);
  const posted = await harness.post("/v1/receipts", { planId, operation: "apply_plan", mayHaveMutated: true, mutationState: "applied", appliedOperations: ["animate_property"], ...input.receipt });
  assert.equal(posted.status, 201);
  await approving;
  return planId;
}
async function ready(t: Parameters<typeof queueHarness>[0]): Promise<QueueHarness> {
  const harness = await queueHarness(t);
  await harness.post("/v1/host-census", hostCensus(1));
  await harness.post("/v1/snapshots", mutableSnapshot("habits-before"));
  return harness;
}
const habits = (harness: QueueHarness) => harness.sidecar.collection.effectNotes.animationHabits();
const samples = (harness: QueueHarness): number | undefined => habits(harness)?.overall?.samples;

test("a verified receipt records the span and easing of each animated property; a failed one records nothing", async (t) => {
  const harness = await ready(t);
  await applied(harness, { operations: [fade(1)], receipt: executed([step("failed")], "failed") });
  await applied(harness, { operations: [fade(1)], receipt: executed([], "passed") });
  assert.equal(habits(harness), null);
  for (const end of [0.5, 0.6, 0.7]) await applied(harness, { operations: [fade(end)], receipt: executed([step("exact")]) });
  const { overall, kinds } = habits(harness) ?? { overall: null, kinds: [] };
  assert.deepEqual(overall, { samples: 3, medianSeconds: 0.6, easing: "easy-ease", keyframes: 2, influence: null });
  assert.deepEqual(kinds.map((kind) => [kind.kind, kind.samples]), [["opacity", 3]]);
  assert.match(usageBriefingLine(harness.sidecar.collection.effectNotes), /animations usually run ~0\.6 s with easy ease/);
});

test("undoing the whole plan takes its sample back", async (t) => {
  const harness = await ready(t);
  const ids: string[] = [];
  for (const end of [0.5, 0.6, 0.7]) ids.push(await applied(harness, { operations: [fade(end)], receipt: executed([step("exact")]) }));
  assert.equal(samples(harness), 3);
  const undoing = harness.agent("ae_undo_plan", { planId: ids[2] ?? null, scope: "last", waitSeconds: 5 });
  await claimWork(harness, "undo_plan");
  await harness.post("/v1/receipts", { planId: ids[2], operation: "undo_plan", status: "executed", executed: true, method: "edit-undo", times: 1 });
  await undoing;
  assert.equal(habits(harness), null, "two samples are left, which says nothing");
});

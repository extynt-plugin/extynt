// Proves the plan_* authoring tools: a plan is created, added to, read back and sealed; a refused batch says what must come back; the per-call ceiling is stated.
import test from "node:test";
import assert from "node:assert/strict";
import { array, boolean, decodeOrThrow, number, object, string } from "@extynt/decode";
import { callTool, listTools, PLAN_UNDO_BATCH_SIZE } from "../src/index.js";
import { authoring, dataOf } from "./support/fixtures.js";
import { storedOperations } from "./support/json-results.js";
import { planIn, recallPageOf, succeeded } from "./support/plan-views.js";
import type { PlanContext } from "./support/plan-views.js";

const sealView = object({ sealed: boolean(), operationCount: number(), plan: object({ digest: string() }) });
const refusedBatchView = object({ notes: array(string()) });

function createEmptyDraft(context: PlanContext): string {
  const created = dataOf(succeeded(callTool("ae_plan_create", { summary: "Title sequence" }, context)));
  assert.equal(created.authored, 0, "a new plan holds nothing yet");
  assert.equal(planIn(context.plans, created.planId).staged?.length, 0, "and it is staged, not sealed");
  return created.planId;
}

function assertDraftIsEditable(context: PlanContext, planId: string): void {
  const operation = { type: "create_layer", target: { compositionId: "comp-main" }, layerType: "text", name: "Title", text: "Directed by" };
  const added = succeeded(callTool("ae_plan_add", { planId, operations: [operation] }, context));
  assert.deepEqual(dataOf(added).verdicts?.map((verdict) => verdict.status), ["accepted"]);
  const recall = recallPageOf(callTool("ae_recall_plan", { planId }, context));
  assert.equal(recall.editable, true, "a plan being authored is editable");
  assert.equal(recall.operationCount, 1);
  assert.equal(recall.operations[0]?.type, "create_layer");
  assert.equal(planIn(context.plans, planId).approvalCapability, undefined, "an unfinished plan issues no approval capability");
}

function assertSealEndsAuthoring(context: PlanContext, planId: string): void {
  const seal = decodeOrThrow(sealView, succeeded(callTool("ae_plan_complete", { planId }, context)).data);
  assert.equal(seal.sealed, true);
  assert.equal(seal.operationCount, 1);
  assert.ok(seal.plan.digest, "the sealed plan carries a digest");
  assert.equal(planIn(context.plans, planId).staged, undefined, "sealing ends authoring");
  assert.ok(planIn(context.plans, planId).sealedAt, "and records when");
}

test("a plan can be created, added to, read back, and sealed, and only then gets a digest and a capability", () => {
  const context = authoring();
  const planId = createEmptyDraft(context);
  assertDraftIsEditable(context, planId);
  assertSealEndsAuthoring(context, planId);
});

test("a refused plan batch says the accepted operations have to come back too", () => {
  const context = authoring();
  const planId = dataOf(succeeded(callTool("ae_plan_create", { summary: "Countdown" }, context))).planId;
  const title = { compositionId: "comp-main", layerId: "layer-title" };
  const added = succeeded(callTool("ae_plan_add", { planId, operations: [
    { type: "set_layer_name", target: title, name: "Title" },
    { type: "ensure_shape_fill", target: title, groupId: "nope", color: [1, 0, 0] },
  ] }, context));
  const refusal = decodeOrThrow(refusedBatchView, added.data).notes.at(-1) ?? "";
  assert.match(refusal, /Nothing was staged: 1 of 2 operations/);
  assert.match(refusal, /is not in the plan either/, "the accepted operation is not kept, and the refusal says so");
  assert.match(refusal, /send the whole batch again/, "so the whole batch is what has to come back");
  assert.doesNotMatch(refusal, /only the fixed operations/);
  assert.equal(storedOperations(planIn(context.plans, planId)).length, 0, "and the plan really holds nothing from it");
});

test("the plan path states its own per-call ceiling instead of promising to split", () => {
  const description = (name: string) => listTools("all").find((entry) => entry.name === name)?.description ?? "";
  for (const name of ["ae_plan_create", "ae_plan_add"]) {
    const text = description(name);
    assert.match(text, new RegExp(`at most ${PLAN_UNDO_BATCH_SIZE} operations`), `${name} names the ceiling`);
    assert.match(text, /refus\w+[^.]*rather than split/, `${name} says the ceiling refuses rather than splits`);
    assert.doesNotMatch(text, /how much fits in one call is the harness's business/, `${name} promises nothing the tool will not do`);
  }
  assert.match(listTools().find((entry) => entry.name === "ae_queue_add")?.description ?? "", /never the ones already queued/);
});

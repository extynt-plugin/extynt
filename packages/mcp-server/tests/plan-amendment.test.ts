// Proves amending and authoring plans: placeholders keep one canonical id across edits and batches, refusals say which direction fixes them, and sealed plans stay closed.
import test from "node:test";
import assert from "node:assert/strict";
import { representativeSnapshot } from "@extynt/project-graph";
import { array, decodeOrThrow, number, object, record, string } from "@extynt/decode";
import { callTool, PLAN_UNDO_BATCH_SIZE } from "../src/index.js";
import { arrayAt, objectAt, objectsIn, stringAt } from "../src/json.js";
import type { JsonObject } from "@extynt/decode";
import { CANONICAL_FIELDS, DECLARES } from "../src/placeholders.js";
import { resolveSettledBatchNames } from "../src/plan-coherence.js";
import { authoring, dataOf } from "./support/fixtures.js";
import { payloadOf, refusalOf } from "./support/json-results.js";
import { planBodyOperations, planIn, planStatusOf, succeeded, targetLayerId } from "./support/plan-views.js";

type AuthoringContext = ReturnType<typeof authoring>;

const MAIN = { compositionId: "comp-main" };
const TITLE_LAYER = { ...MAIN, layerId: "layer-title" };
const CALLER_TITLE = { ...MAIN, layerId: "__new__:title" };
const OPACITY = "ADBE Transform Group/ADBE Opacity";
const POSITION = "ADBE Transform Group/ADBE Position";
const CANONICAL_LAYER = "__new__:layer0";

const refusalView = object({ data: object({ planId: string(), problems: array(object({ code: string() })) }) });
const duplicateView = object({ renamedPlaceholders: record(string(), string()) });
const countView = object({ operationCount: number() });

function createPlan(context: AuthoringContext, summary: string): string {
  return dataOf(succeeded(callTool("ae_plan_create", { summary }, context))).planId;
}

function addOperations(context: AuthoringContext, planId: string, operations: JsonObject[]) {
  return succeeded(callTool("ae_plan_add", { planId, operations }, context));
}

function createLayer(layerId: string, layerType: string, name: string): JsonObject {
  return { type: "create_layer", target: { ...MAIN, layerId }, layerType, name };
}

function renameLayer(layerId: string, name: string): JsonObject {
  return { type: "set_layer_name", target: { ...MAIN, layerId }, name };
}

function verdictStatuses(result: ReturnType<typeof addOperations>): string[] {
  return dataOf(result).verdicts?.map((verdict) => verdict.status) ?? [];
}

function amend(context: AuthoringContext, planId: string, edits: JsonObject[]) {
  return callTool("ae_amend_plan", { planId, edits }, context);
}

function proposeRefusedRename(context: AuthoringContext): string {
  const proposed = callTool("ae_propose_plan", {
    summary: "Create the word, then rename it",
    operations: [
      { type: "create_layer", layerType: "text", name: "SIGNAL", text: "SIGNAL", target: CALLER_TITLE },
      { type: "set_layer_name", name: "Renamed", propertyPath: OPACITY, target: CALLER_TITLE },
    ],
  }, context);
  assert.equal(proposed.ok, false, "the plan is refused for the second operation");
  const refusal = decodeOrThrow(refusalView, proposed).data;
  assert.equal(refusal.problems[0]?.code, "UNKNOWN_FIELD");
  return refusal.planId;
}

function assertRepairRebindsToCreator(context: AuthoringContext, planId: string): void {
  const repaired = amend(context, planId, [{ op: "replace", index: 1, operation: { type: "set_layer_name", name: "Renamed", target: CALLER_TITLE } }]);
  assert.ok(repaired.ok, `the repaired operation must find the layer the plan creates: ${JSON.stringify(repaired).slice(0, 300)}`);
  const stored = planBodyOperations(planIn(context.plans, planId));
  assert.equal(targetLayerId(stored[0]), CANONICAL_LAYER, "the creator keeps its canonical id");
  assert.equal(targetLayerId(stored[1]), CANONICAL_LAYER, "and the repaired operation was rebound to it");
}

function assertRecreatedObjectKeepsItsId(context: AuthoringContext, planId: string): void {
  const recreated = { type: "create_layer", layerType: "text", name: "SIGNAL", text: "SIGNAL TWO", target: CALLER_TITLE };
  const recrafted = amend(context, planId, [{ op: "replace", index: 0, operation: recreated }]);
  assert.ok(recrafted.ok, JSON.stringify(recrafted).slice(0, 300));
  const stored = planBodyOperations(planIn(context.plans, planId));
  assert.equal(targetLayerId(stored[0]), CANONICAL_LAYER, "a re-created object keeps the id the plan already uses");
  assert.equal(targetLayerId(stored[1]), CANONICAL_LAYER);
}

function assertInsertedObjectKeepsItsName(context: AuthoringContext, planId: string): void {
  const master = { ...MAIN, layerId: "__new__:master" };
  const inserted = amend(context, planId, [
    { op: "insert", index: 0, operation: { type: "create_layer", layerType: "null", name: "Master Control", target: master } },
    { op: "insert", index: 2, operation: { type: "set_layer_parent", target: CALLER_TITLE, parentLayerId: "__new__:master" } },
  ]);
  assert.ok(inserted.ok, JSON.stringify(inserted).slice(0, 300));
  const stored = planBodyOperations(planIn(context.plans, planId));
  assert.equal(targetLayerId(stored[0]), "__new__:master", "a new object keeps the model's name for it");
  assert.equal(stringAt(stored[2], "parentLayerId"), "__new__:master", "and the operation that uses it matches by that name");
  assert.equal(targetLayerId(stored[2]), CANONICAL_LAYER, "while a name the plan already owns resolves to the id the plan uses");
}

test("a repaired operation can still name what the plan creates", () => {
  const context = authoring();
  const planId = proposeRefusedRename(context);
  assertRepairRebindsToCreator(context, planId);
  assertRecreatedObjectKeepsItsId(context, planId);
  assertInsertedObjectKeepsItsName(context, planId);
});

function authoredRingPlan(context: AuthoringContext): string {
  const planId = createPlan(context, "Ring");
  assert.equal(dataOf(addOperations(context, planId, [createLayer("__new__:ring", "shape", "Ring")])).authored, 1);
  const status = planStatusOf(callTool("ae_get_plan_status", { planId }, context));
  const echoed = objectsIn(status.operations).map((operation) => stringAt(operation, "type"));
  assert.deepEqual(echoed, ["create_layer"], "a plan being authored echoes the operations it holds");
  return planId;
}

function assertAmendmentKeepsAuthoringOpen(context: AuthoringContext, planId: string): void {
  const settings = { type: "set_composition_settings", target: MAIN, settings: { durationSeconds: 12 } };
  const amended = succeeded(amend(context, planId, [{ op: "insert", index: 0, operation: settings }]));
  assert.equal(decodeOrThrow(countView, amended.data).operationCount, 2, "the insert lands in front of the operation already sent rather than replacing it");

  const afterAmend = addOperations(context, planId, [renameLayer("__new__:ring", "Ring 2")]);
  assert.deepEqual(verdictStatuses(afterAmend), ["accepted"], "a name declared before the amendment still resolves after it: " + JSON.stringify(dataOf(afterAmend).verdicts));

  const refused = amend(context, planId, [{ op: "insert", index: 0, operation: renameLayer("no-such-layer", "x") }]);
  assert.equal(refused.ok, false, "an amendment that cannot run is refused");
  const afterRefusal = callTool("ae_plan_add", { planId, operations: [renameLayer("__new__:ring", "Ring 3")] }, context);
  assert.ok(afterRefusal.ok, "and ae_plan_add still works after it");
}

test("an authored plan stays addressable and authorable across an amendment", () => {
  const context = authoring();
  assertAmendmentKeepsAuthoringOpen(context, authoredRingPlan(context));
});

test("a shape fault that is not about a placeholder keeps the validator's own reason", () => {
  const context = authoring();
  const planId = createPlan(context, "Shapes");
  const fill = (groupId: string): JsonObject => ({ type: "ensure_shape_fill", target: { ...MAIN, layerId: "__new__:bg" }, groupId, color: [1, 0, 0] });
  const added = addOperations(context, planId, [createLayer("__new__:bg", "shape", "BG"), fill("not-a-group")]);
  const verdict = dataOf(added).verdicts?.[1];
  assert.equal(verdict?.status, "rejected");
  assert.match(String(verdict?.detail), /Shape group must be "root"/, "the validator's own reason survives");
  assert.doesNotMatch(String(verdict?.detail), /no operation in this plan creates/, "and is not replaced by a placeholder story that is false about the plan");

  const fixed = addOperations(context, planId, [createLayer("__new__:bg", "shape", "BG"), fill("root")]);
  assert.deepEqual(verdictStatuses(fixed), ["accepted", "accepted"]);
});

function firstBatchTitlePlan(context: AuthoringContext): string {
  const planId = createPlan(context, "Text reveal");
  const title = { ...createLayer("__new__:title", "text", "Title"), text: "Directed by" };
  const first = addOperations(context, planId, [title]);
  assert.deepEqual(verdictStatuses(first), ["accepted"]);
  assert.match(String(dataOf(first).verdicts?.[0]?.detail), /__new__:title/, "the verdict still names the rewrite in the caller's own vocabulary");
  return planId;
}

function assertCrossBatchReferenceResolves(context: AuthoringContext, planId: string): void {
  const second = addOperations(context, planId, [renameLayer("__new__:title", "Hero")]);
  assert.deepEqual(verdictStatuses(second), ["accepted"], "a cross-add reference is accepted, not refused");
  const completed = payloadOf(callTool("ae_plan_complete", { planId }, context));
  const operations = objectsIn(arrayAt(objectAt(completed, "plan"), "operations"));
  assert.deepEqual(operations.map((operation) => [stringAt(operation, "type"), targetLayerId(operation)]), [["create_layer", CANONICAL_LAYER], ["set_layer_name", CANONICAL_LAYER]], "both operations address one canonical object");
}

test("a later add can address an object an earlier add created, and complete is where ordering is judged", () => {
  const context = authoring();
  assertCrossBatchReferenceResolves(context, firstBatchTitlePlan(context));
});

function assertLaterDeclarationIsRefused(context: AuthoringContext): void {
  const planId = createPlan(context, "Out of order");
  const title = { ...createLayer("__new__:title", "text", "Title"), text: "Directed by" };
  const outOfOrder = addOperations(context, planId, [renameLayer("__new__:title", "Hero"), title]);
  const verdicts = dataOf(outOfOrder).verdicts ?? [];
  assert.equal(verdicts[0]?.status, "rejected", "the naming operation is refused");
  assert.equal(verdicts[0]?.code, "TARGET_NOT_FOUND");
  assert.match(String(verdicts[0]?.detail), /operation 1 comes after it/, "and the message says which operation declares it and that it comes after");
  assert.match(String(verdicts[0]?.detail), /BEFORE/, "and states the rule rather than leaving it to be discovered");
  assert.equal(verdicts[1]?.status, "accepted", "the creating operation itself is fine");
  assert.equal(dataOf(outOfOrder).authored, 0, "and nothing was staged from a batch with a refusal in it");
}

function assertDanglingReferenceIsRefused(context: AuthoringContext): void {
  const planId = createPlan(context, "Dangling");
  const dangling = addOperations(context, planId, [renameLayer("__new__:nothing", "Hero")]);
  const verdict = dataOf(dangling).verdicts?.[0];
  assert.equal(verdict?.status, "rejected");
  assert.equal(verdict?.code, "TARGET_NOT_FOUND");
  assert.match(String(verdict?.detail), /no operation in this plan creates/);
}

function assertEarlierDeclarationResolves(context: AuthoringContext): void {
  const planId = createPlan(context, "In order");
  addOperations(context, planId, [{ ...createLayer("__new__:title", "text", "Title"), text: "Directed by" }]);
  const rename = addOperations(context, planId, [renameLayer("__new__:title", "Hero")]);
  assert.deepEqual(verdictStatuses(rename), ["accepted"], "an earlier declaration resolves, and the operation is simply part of the plan");
}

test("an add refuses a reference that can never resolve, and says which direction fixes it", () => {
  const context = authoring();
  assertLaterDeclarationIsRefused(context);
  assertDanglingReferenceIsRefused(context);
  assertEarlierDeclarationResolves(context);
});

test("a plan that has been sealed cannot be added to, and one written in a single call is not authorable", () => {
  const context = authoring();
  const planId = createPlan(context, "Two steps");
  addOperations(context, planId, [{ ...createLayer("__new__:a", "text", "A"), text: "A" }]);
  callTool("ae_plan_complete", { planId }, context);
  const late = callTool("ae_plan_add", { planId, operations: [renameLayer("layer-title", "B")] }, context);
  assert.equal(refusalOf(late).code, "PLAN_NOT_AUTHORING", "a sealed plan is no longer a draft");
  const proposed = succeeded(callTool("ae_propose_plan", { summary: "Whole thing", operations: [renameLayer("layer-title", "Hero")] }, context));
  const onProposal = callTool("ae_plan_add", { planId: dataOf(proposed).planId, operations: [renameLayer("layer-title", "Again")] }, context);
  assert.equal(refusalOf(onProposal).code, "PLAN_NOT_AUTHORING");
});

test("a batch larger than the undo group is refused rather than silently split", () => {
  const context = authoring();
  const planId = createPlan(context, "Too much at once");
  const operations = Array.from({ length: PLAN_UNDO_BATCH_SIZE + 1 }, () => renameLayer("layer-title", "Hero"));
  const added = callTool("ae_plan_add", { planId, operations }, context);
  assert.match(refusalOf(added).message, new RegExp(`1–${PLAN_UNDO_BATCH_SIZE} entries`));
});

test("every declaring field in DECLARES has a canonical-field key of the same shape, so neither table can drift", () => {
  for (const [type, fields] of Object.entries(CANONICAL_FIELDS)) {
    const declared = new Set(DECLARES[type] ?? []);
    assert.ok(declared.size, `${type} names canonical fields but declares nothing`);
    for (const field of Object.keys(fields)) {
      assert.ok(declared.has(field), `${type}: CANONICAL_FIELDS names ${field}, which DECLARES does not list as a declaring field (${[...declared].join(", ")})`);
    }
  }
});

test("a duplicated layer's canonical id is minted where DECLARES looks, and a duplicate with no new id is refused", () => {
  const context = authoring();
  const duplicate: JsonObject = { type: "duplicate_layer", target: TITLE_LAYER, newLayerId: "__new__:copy" };
  const result = succeeded(callTool("ae_propose_plan", { summary: "Duplicate", operations: [duplicate, renameLayer("__new__:copy", "Copy")] }, context));
  const operations = objectsIn(arrayAt(objectAt(payloadOf(result), "plan"), "operations"));
  assert.equal(stringAt(operations[0], "newLayerId"), CANONICAL_LAYER, "the duplicate's canonical id is minted at the operation's top level, which is where DECLARES now looks");
  assert.equal(targetLayerId(operations[1]), CANONICAL_LAYER);
  assert.equal(decodeOrThrow(duplicateView, result.data).renamedPlaceholders["__new__:copy"], CANONICAL_LAYER, "and the caller's name is bound to it");
  const unnamed = callTool("ae_propose_plan", { summary: "Unnamed duplicate", operations: [{ type: "duplicate_layer", target: TITLE_LAYER }] }, context);
  assert.equal(refusalOf(unnamed).code, "INVALID_ARGUMENT");
});

const SETTLED_NAMES = { "__new__:layer1": "14" };
const AUTHORED: JsonObject = { type: "set_layer_name", target: { ...MAIN, layerId: "__new__:layer1" }, name: "Hero" };

function resolvedLayerId(operation: JsonObject): string | undefined {
  return targetLayerId(objectsIn(resolveSettledBatchNames([operation], SETTLED_NAMES))[0]);
}

test("settled batch names substitute in place, and only for an earlier settled batch's own names", () => {
  assert.equal(resolvedLayerId(AUTHORED), "14", "the id a settled batch's receipt carried replaces the placeholder");
  assert.equal(resolvedLayerId(renameLayer("__new__:nothing", "Hero")), "__new__:nothing", "a name no settled batch created is left exactly as written");
  assert.equal(resolvedLayerId(renameLayer("__new__:layer9", "Hero")), "__new__:layer9", "and only an EARLIER settled batch may satisfy a reference");
  assert.equal(targetLayerId(AUTHORED), "__new__:layer1", "the caller's own object is never rewritten in place");
});

function snapshotAfterBatchOne() {
  const [template] = representativeSnapshot.compositions[0]?.layers ?? [];
  assert.ok(template, "the fixture has a layer to copy");
  return {
    ...representativeSnapshot,
    compositions: representativeSnapshot.compositions.map((composition) => composition.id === "comp-main"
      ? { ...composition, layers: [...composition.layers, { ...template, id: "14", index: composition.layers.length + 1, name: "Hero (batch one)", isSelected: false }] }
      : composition),
  };
}

test("a placeholder nobody declares is refused unless an earlier settled batch reported the real id", () => {
  const context = authoring();
  const planId = createPlan(context, "Second batch");
  const refused = addOperations(context, planId, [structuredClone(AUTHORED)]);
  assert.equal(dataOf(refused).verdicts?.[0]?.status, "rejected", "with no settled batch, a placeholder nobody declares is refused at authoring time");

  const settled = { ...context, snapshot: snapshotAfterBatchOne(), settledBatchIds: SETTLED_NAMES };
  const accepted = succeeded(callTool("ae_plan_add", { planId, operations: [structuredClone(AUTHORED)] }, settled));
  assert.equal(dataOf(accepted).verdicts?.[0]?.status, "accepted", "an id a settled batch reported needs no declaration in this plan");
  const sealed = payloadOf(callTool("ae_plan_complete", { planId }, settled));
  const operations = objectsIn(arrayAt(objectAt(sealed, "plan"), "operations"));
  assert.equal(targetLayerId(operations[0]), "14", "and the sealed plan carries the real id the host will resolve in this command");
});

function positionOperation(target: JsonObject, value: number[]): JsonObject {
  return { type: "set_layer_property", target, role: "transform.position", propertyPath: POSITION, value };
}

function wordPlan(context: AuthoringContext, summary: string): string {
  const planId = createPlan(context, summary);
  addOperations(context, planId, [{ ...createLayer("__new__:word", "text", "SIGNAL"), text: "SIGNAL" }]);
  return planId;
}

test("an authoring plan amended after the selection moved follows the current selection", () => {
  const context = authoring();
  const planId = wordPlan(context, "Title");
  context.snapshot = { ...representativeSnapshot, selectionFingerprint: "fp3-moved-selection" };
  const insert: JsonObject = { op: "insert", index: 1, operation: positionOperation({ ...MAIN, layerId: "__new__:word" }, [0, 61]) };
  const amended = amend(context, planId, [insert]);
  assert.ok(amended.ok, JSON.stringify(amended).slice(0, 400));
  const stored = planIn(context.plans, planId);
  assert.equal(stored.plan.selectionFingerprint, "fp3-moved-selection");
  for (const operation of planBodyOperations(stored)) assert.equal(stringAt(objectAt(operation, "target"), "selectionFingerprint"), "fp3-moved-selection");
  context.snapshot = { ...representativeSnapshot, fingerprint: "fp3-moved-graph" };
  assert.equal(amend(context, planId, [{ op: "remove", index: 1 }]).ok, false);
});

test("an edit whose target names no composition takes the one ae_queue_add would, and run removals explain the index shift", () => {
  const context = authoring();
  const planId = createPlan(context, "Title");
  const word = { ...createLayer("__new__:word", "text", "SIGNAL"), text: "SIGNAL" };
  addOperations(context, planId, [word, positionOperation({ ...MAIN, layerId: "__new__:word" }, [0, 60])]);
  const amended = amend(context, planId, [{ op: "replace", index: 1, operation: positionOperation({ layerId: "__new__:word" }, [0, 61]) }]);
  assert.ok(amended.ok, JSON.stringify(amended).slice(0, 400));
  const stored = planBodyOperations(planIn(context.plans, planId));
  assert.equal(stringAt(objectAt(stored[1], "target"), "compositionId"), "comp-main");
  const shifted = amend(context, planId, [{ op: "remove", index: 0 }, { op: "remove", index: 1 }]);
  assert.equal(shifted.ok, false);
  assert.match(JSON.stringify(shifted), /highest index first/);
});

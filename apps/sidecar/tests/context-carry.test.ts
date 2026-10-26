/** The carried project summary: the open comp, what verified batches created or changed, the last outcome, and a hard size bound. The fixtures carry only the fields the summary reads. */
import assert from "node:assert/strict";
import test from "node:test";
import { carriedContextSummary, MAX_CARRIED_CONTEXT_CHARS, recentBuildSummary } from "../src/context-carry.js";

interface Payload {
  readonly type: string;
  readonly name?: string;
  readonly propertyPath?: string;
  readonly effectMatchName?: string;
  readonly target?: { readonly layerId?: string; readonly propertyPath?: string };
}

type Operations = Record<string, { payload: Payload }>;
type Input = Parameters<typeof carriedContextSummary<Payload>>[0];
type Batch = Input["state"]["batches"][string];
type Snapshot = NonNullable<Input["snapshot"]>;
type Execution = Batch["execution"];
type Outcome = NonNullable<Execution["receipt"]>["outcomes"][number];
type Binding = NonNullable<NonNullable<Execution["receipt"]>["createdBindings"]>[number];

interface Built {
  readonly id: string;
  readonly batch: Batch;
}

function snapshot(activeId: string | null, layers: Array<{ id: string; name: string }>): Snapshot {
  return { activeCompositionId: activeId, compositions: [{ id: "comp-9", name: "Smoke", width: 1920, height: 1080, duration: 10, frameRate: 30, layers }, { id: "comp-0", name: "Other", width: 100, height: 100, duration: 1, frameRate: 24, layers: [] }] };
}

function executed(outcomes: Outcome[] = [], createdBindings: Binding[] = []): Execution {
  return { state: "executed", receipt: { outcomes, createdBindings } };
}

function batch(id: string, over: Partial<Batch> = {}): Built {
  return { id, batch: { lifecycle: "settled", summary: `Batch ${id}`, recovery: { state: "none" }, verification: { state: "verified" }, execution: executed(), ...over } };
}

function stateWith(batches: Built[], operations: Operations = {}): Input["state"] {
  return { jobs: { "job-1": { jobId: "job-1", createdAt: "2026-10-12T10:00:00Z", batchIds: batches.map((entry) => entry.id) } }, batches: Object.fromEntries(batches.map((entry) => [entry.id, entry.batch])), operations };
}

const created = (placeholder: string, createdId: string, operationId: string): Binding => ({ placeholder, createdId, operationId });
const outcome = (type: string, targetLayerId?: string, operationId = ""): Outcome => ({ operationId, type, ...(targetLayerId ? { readback: { targetLayerId } } : {}) });
const OPERATIONS: Operations = { "op-comp": { payload: { type: "create_composition", name: "Smoke" } }, "op-solid": { payload: { type: "create_layer", name: "Red Solid" } } };
const creatorBatch = (over: Partial<Batch> = {}): Built => batch("b1", { execution: executed([outcome("create_layer")], [created("__new__:comp", "comp-9", "op-comp"), created("__new__:solid", "layer-12", "op-solid")]), ...over });

test("nothing is carried before any batch exists", () => {
  assert.equal(carriedContextSummary({ state: stateWith([]), snapshot: snapshot("comp-9", []) }), undefined);
});

test("the summary names the open comp and the ids a verified batch created", () => {
  const text = carriedContextSummary({ state: stateWith([creatorBatch()], OPERATIONS), snapshot: snapshot("comp-9", [{ id: "layer-12", name: "Red Solid" }]) });
  assert.ok(text);
  assert.match(text, /comp comp-9 "Smoke" \(1920x1080, 10s, 30fps\)/);
  assert.match(text, /created comp comp-9 "Smoke"/);
  assert.match(text, /created layer layer-12 "Red Solid"/);
  assert.match(text, /Last plan: applied and verified/);
  assert.doesNotMatch(text, /Built but not the open comp/);
});

test("a built comp that is not open is flagged with its id, and no open comp is said so", () => {
  const state = stateWith([creatorBatch()], OPERATIONS);
  assert.match(carriedContextSummary({ state, snapshot: snapshot("comp-0", []) }) ?? "", /Built but not the open comp: comp-9 "Smoke"/);
  assert.match(carriedContextSummary({ state, snapshot: snapshot(null, []) }) ?? "", /no composition/);
});

test("a changed layer resolves a placeholder target, and an undone batch lists nothing as existing", () => {
  const rename = batch("b2", { execution: executed([outcome("set_layer_name", "__new__:solid")]) });
  const text = carriedContextSummary({ state: stateWith([creatorBatch(), rename], OPERATIONS), snapshot: snapshot("comp-9", [{ id: "layer-12", name: "Hero" }]) });
  assert.match(text ?? "", /changed layer layer-12 "Hero"/);
});

test("the summary stays under the size bound however much was built", () => {
  const operations: Operations = {};
  const batches: Built[] = [];
  for (let index = 0; index < 40; index += 1) {
    const bindings = Array.from({ length: 30 }, (_, n) => { operations[`op-${index}-${n}`] = { payload: { type: "create_layer", name: `A rather long layer name number ${index}-${n} for the bound` } }; return created(`__new__:${index}-${n}`, `layer-${index}-${n}`, `op-${index}-${n}`); });
    batches.push(batch(`b${index}`, { summary: "x".repeat(400), execution: executed([], bindings) }));
  }
  const layers = Object.keys(operations).map((key) => ({ id: key.replace("op-", "layer-"), name: "n".repeat(80) }));
  const text = carriedContextSummary({ state: stateWith(batches, operations), snapshot: snapshot("comp-9", layers) });
  assert.ok(text && text.length <= MAX_CARRIED_CONTEXT_CHARS, `length ${text?.length}`);
  assert.match(text, /Last plan:/);
  assert.match(text, /omitted/);
});

test("a typical summary is well under the bound", () => {
  const text = carriedContextSummary({ state: stateWith([creatorBatch()], OPERATIONS), snapshot: snapshot("comp-9", [{ id: "layer-12", name: "Red Solid" }]) });
  assert.ok(text && text.length < 900, `length ${text?.length}`);
});

test("an undone batch lists nothing as existing, beside a live one", () => {
  const live = batch("b2", { summary: "Second", execution: executed([outcome("set_layer_name", "layer-5")]) });
  const text = carriedContextSummary({ state: stateWith([creatorBatch({ recovery: { state: "undone" } }), live], OPERATIONS), snapshot: snapshot("comp-9", [{ id: "layer-5", name: "Kept" }]) });
  assert.match(text ?? "", /undone/);
  assert.doesNotMatch(text ?? "", /layer-12|Built but not/);
  assert.equal(carriedContextSummary({ state: stateWith([creatorBatch({ recovery: { state: "undone" } })], OPERATIONS), snapshot: snapshot("comp-9", []) }), undefined, "nothing live, so nothing is carried");
});

test("a snapshot from another project shares no ids, so nothing is carried", () => {
  const other: Snapshot = { activeCompositionId: "other-comp", compositions: [{ id: "other-comp", name: "Elsewhere", width: 10, height: 10, duration: 1, frameRate: 24, layers: [{ id: "other-layer", name: "X" }] }] };
  assert.equal(carriedContextSummary({ state: stateWith([creatorBatch()], OPERATIONS), snapshot: other }), undefined);
  assert.equal(carriedContextSummary({ state: stateWith([creatorBatch()], OPERATIONS), snapshot: undefined }), undefined);
});

test("a deleted layer is not listed, and a built comp that is gone is not pointed at", () => {
  const text = carriedContextSummary({ state: stateWith([creatorBatch()], OPERATIONS), snapshot: snapshot("comp-9", [{ id: "layer-99", name: "Other layer" }]) });
  assert.ok(text);
  assert.doesNotMatch(text, /created layer layer-12/);
  assert.match(text, /created comp comp-9/);
  const goneComp: Snapshot = { activeCompositionId: "comp-0", compositions: [{ id: "comp-0", name: "Other", width: 1, height: 1, duration: 1, frameRate: 24, layers: [{ id: "layer-12", name: "Red Solid" }] }] };
  const without = carriedContextSummary({ state: stateWith([creatorBatch()], OPERATIONS), snapshot: goneComp });
  assert.ok(without);
  assert.doesNotMatch(without, /Built but not the open comp|created comp/);
});

test("what was applied to a layer after it was created is carried, so a continuation need not inspect the layer", () => {
  const operations: Operations = {
    ...OPERATIONS,
    "op-glow": { payload: { type: "ensure_effect", effectMatchName: "ADBE Glo2", target: { layerId: "__new__:solid" } } },
    "op-scale": { payload: { type: "set_keyframes", propertyPath: "ADBE Transform Group/ADBE Scale", target: { layerId: "__new__:solid" } } },
    "op-pos": { payload: { type: "set_keyframes", target: { layerId: "__new__:solid", propertyPath: "ADBE Transform Group/ADBE Position" } } },
  };
  const outcomes = [outcome("ensure_effect", "__new__:solid", "op-glow"), outcome("set_keyframes", "__new__:solid", "op-scale"), outcome("set_keyframes", "__new__:solid", "op-pos")];
  const detail = batch("b2", { summary: "Animate", execution: executed(outcomes) });
  const text = carriedContextSummary({ state: stateWith([creatorBatch(), detail], operations), snapshot: snapshot("comp-9", [{ id: "layer-12", name: "Red Solid" }]) });
  assert.match(text ?? "", /Applied so far on existing layers/);
  assert.match(text ?? "", /layer-12 "Red Solid": ensure_effect\(ADBE Glo2\); set_keyframes\(Scale, Position\)/);
});

test("the recent build is the carried summary, bounded, and absent when nothing is carried", () => {
  assert.equal(recentBuildSummary({ state: stateWith([]), snapshot: snapshot("comp-9", []) }), undefined);
  const state = stateWith([creatorBatch()], OPERATIONS);
  const open = snapshot("comp-9", [{ id: "layer-12", name: "Red Solid" }]);
  assert.equal(recentBuildSummary({ state, snapshot: open }), carriedContextSummary({ state, snapshot: open }));
  const many = Array.from({ length: 60 }, (_, index) => ({ id: `layer-${index + 20}`, name: `Layer number ${index}` }));
  const bounded = recentBuildSummary({ state, snapshot: snapshot("comp-9", many) });
  assert.ok(bounded && bounded.length <= 600);
});
